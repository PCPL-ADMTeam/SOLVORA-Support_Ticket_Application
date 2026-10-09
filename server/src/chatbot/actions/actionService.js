const crypto = require("crypto");
const prisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");
const { recordAudit } = require("../../utils/audit");
const { ChatError, CODES } = require("../chatbot.errors");
const { recordChatAudit } = require("../chatbot.audit");
const { ACTIONS } = require("./registry");
const { actionAllowed, permissionsFor } = require("../permissions");

const TTL_MS = 10 * 60 * 1000;

// Write flow, in order:
//   1. proposeAction  - parse/interpret -> resolve -> validate -> PREVIEW. Stores a PENDING row
//                       (with a hash of a secret confirmation token and a snapshot of the
//                       records involved). Changes nothing.
//   2. confirmAction  - ONLY via POST /chatbot/actions/:id/confirm, by the same authenticated
//                       ADMIN, in the same conversation, presenting the token, within 10
//                       minutes, once. Re-checks the role, re-reads the records (refuses if
//                       they changed since the preview), then executes through the existing
//                       service method and reports the REAL result.
//   3. cancelAction   - discards the proposal.
// A typed "yes" never executes anything, and neither the interpreter model nor
// ticket text can create, see, or use a confirmation token.

const audit = (user, conversationId, action, id, result) =>
  recordChatAudit({ userId: user.id, conversationId, action, resourceType: "ChatPendingAction", resourceId: id, result });

const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

// Deny by default: the action must be in the policy for this role, and the role's
// (server-derived) permissions must cover it. Checked at preview and AGAIN at confirmation.
function requireActionPermission(user, actionName) {
  if (!actionAllowed(actionName, user.role.name, permissionsFor(user.role.name))) {
    throw new ChatError(CODES.ACCESS_DENIED, { internal: `action ${actionName} not permitted for ${user.role.name}` });
  }
}

// Fingerprint of the records an action depends on, taken at preview time and
// compared again just before execution (optimistic concurrency via updatedAt
// and the few fields that matter).
async function snapshotVersions(params) {
  const snap = {};
  if (params.userId) {
    const u = await prisma.user.findUnique({ where: { id: params.userId }, select: { updatedAt: true, isActive: true, roleId: true, departmentId: true } });
    snap.user = u ? JSON.stringify(u) : null;
  }
  if (params.departmentId) {
    const d = await prisma.department.findUnique({ where: { id: params.departmentId }, select: { updatedAt: true, name: true } });
    snap.department = d ? JSON.stringify(d) : null;
  }
  if (params.ticketId) {
    const t = await prisma.ticket.findUnique({ where: { id: params.ticketId }, select: { updatedAt: true, status: true, priorityId: true } });
    snap.ticket = t ? JSON.stringify(t) : null;
  }
  return snap;
}

async function proposeAction(ctx, parsed, meta = {}) {
  const { scope, conversationId } = ctx;
  const def = ACTIONS[parsed.action];
  if (!def) throw new ChatError(CODES.UNSUPPORTED_INTENT, { internal: `unknown action ${parsed.action}` });
  try {
    requireActionPermission(scope.user, parsed.action);
  } catch (err) {
    await audit(scope.user, conversationId, "ACTION_PERMISSION_DENIED", parsed.action, "DENIED");
    throw err;
  }

  const prepared = await def.prepare({ actorId: scope.userId, user: scope.user, scope, audit: (a, rt, rid, res) => recordChatAudit({ userId: scope.userId, conversationId, action: a, resourceType: rt, resourceId: rid, result: res }) }, parsed.args);
  const expiresAt = new Date(Date.now() + TTL_MS);
  const confirmationToken = crypto.randomBytes(24).toString("hex");
  const row = await prisma.chatPendingAction.create({
    data: {
      userId: scope.userId,
      conversationId: conversationId || null,
      action: parsed.action,
      intent: meta.intent || null,
      interpretation: meta.method || "rule",
      params: prepared.params,
      summary: prepared.summary,
      tokenHash: sha256(confirmationToken),
      resourceVersions: await snapshotVersions(prepared.params),
      expiresAt,
    },
  });
  await audit(scope.user, conversationId, "ACTION_PROPOSED", row.id, "SUCCESS");
  // The raw token is returned ONCE, to this admin's browser, and never stored.
  return { id: row.id, action: parsed.action, title: def.title, summary: prepared.summary, impact: prepared.impact, expiresAt, confirmationToken };
}

async function loadOwnPending(user, actionId, { token, conversationId, typed } = {}) {
  const row = await prisma.chatPendingAction.findUnique({ where: { id: actionId } });
  // `typed` is set only by confirmTyped() below (server-internal), never from the request body.
  const tokenOk = row?.tokenHash && (typed === true || (token && crypto.timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(row.tokenHash))));
  // Owner, same conversation and correct token, otherwise indistinguishable from "not found".
  const bound = row && row.userId === user.id && (!row.conversationId || row.conversationId === conversationId);
  if (!row || !bound || !tokenOk) {
    if (row) await audit(user, row.conversationId, "ACTION_ACCESS_DENIED", actionId, "DENIED");
    throw new ChatError(CODES.ACTION_NOT_FOUND);
  }
  return row;
}

const STATUS_TEXT = {
  EXECUTED: "This change was already made.",
  FAILED: "This change was already attempted and did not succeed.",
  CANCELLED: "This change was cancelled.",
  EXPIRED: "This request expired. Please ask me again.",
  CONFIRMING: "This change is already being processed.",
};

async function saveResultMessage(row, text) {
  if (!row.conversationId) return;
  await prisma.chatMessage.create({
    data: { conversationId: row.conversationId, senderType: "ASSISTANT", messageText: text, intent: "action_result", structuredPayload: { actionId: row.id, action: row.action } },
  });
}

async function failWith(row, user, message, code) {
  await prisma.chatPendingAction.update({ where: { id: row.id }, data: { status: "FAILED", resultMessage: message, resolvedAt: new Date() } });
  await audit(user, row.conversationId, "ACTION_FAILED", row.id, "ERROR");
  await saveResultMessage(row, message);
  return { actionId: row.id, status: "FAILED", message, ...(code ? { code } : {}) };
}

async function confirmAction(user, actionId, proof = {}) {
  const row = await loadOwnPending(user, actionId, proof);
  // The caller's CURRENT role must still be allowed to run this action.
  try {
    requireActionPermission(user, row.action);
  } catch (err) {
    await audit(user, row.conversationId, "ACTION_PERMISSION_DENIED", row.id, "DENIED");
    throw err;
  }

  if (row.status !== "PENDING") return { actionId, status: row.status, message: row.resultMessage || STATUS_TEXT[row.status] || "This request is no longer pending." };

  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.chatPendingAction.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "EXPIRED", resolvedAt: new Date() } });
    await audit(user, row.conversationId, "ACTION_EXPIRED", row.id, "ERROR");
    return { actionId, status: "EXPIRED", message: STATUS_TEXT.EXPIRED };
  }

  // Atomic claim: only one concurrent confirm can move PENDING -> CONFIRMING.
  const claim = await prisma.chatPendingAction.updateMany({ where: { id: row.id, userId: user.id, status: "PENDING" }, data: { status: "CONFIRMING" } });
  if (claim.count !== 1) return { actionId, status: "CONFIRMING", message: STATUS_TEXT.CONFIRMING };

  // Revalidate resource state: refuse if anything involved changed since the preview.
  const before = row.resourceVersions || {};
  const now = await snapshotVersions(row.params);
  if (Object.keys(before).some((k) => before[k] !== now[k])) {
    return failWith(row, user, "That change wasn't made: something it depends on was changed after the preview. Nothing was changed. Please ask me again.", CODES.RESOURCE_VERSION_CONFLICT);
  }

  const def = ACTIONS[row.action];
  let status;
  let message;
  let ticketId = null;
  let ticketNumber = null;
  try {
    if (!def) throw new Error("unknown action");
    // An action returns its message, or { message, ticketId } when it made a ticket.
    const out = await def.execute({ actorId: user.id, user, scope: { role: user.role.name, userId: user.id } }, row.params);
    message = typeof out === "string" ? out : out.message;
    ticketId = (typeof out === "object" && out.ticketId) || row.params?.ticketId || null;
    ticketNumber = (typeof out === "object" && out.ticketNumber) || row.params?.ticketNumber || null;
    status = "EXECUTED";
  } catch (err) {
    status = "FAILED";
    if (err instanceof ApiError || err instanceof ChatError) {
      // Application-level rejections carry user-facing text already.
      message = def?.failurePrefix ? `${def.failurePrefix}${err.message}` : `That change wasn't made: ${err.message}`;
    } else {
      console.error(`[chatbot] action ${row.action} failed: ${err.code || err.name}: ${err.message}`);
      message = "That change couldn't be completed because of a server error. Nothing was reported as done; please check and try again.";
    }
  }

  await prisma.chatPendingAction.update({ where: { id: row.id }, data: { status, resultMessage: message, resolvedAt: new Date() } });
  await audit(user, row.conversationId, status === "EXECUTED" ? "ACTION_EXECUTED" : "ACTION_FAILED", row.id, status === "EXECUTED" ? "SUCCESS" : "ERROR");
  if (status === "EXECUTED") {
    // Also visible on the admin Audit Logs page, next to the service's own entry.
    await recordAudit({
      userId: user.id,
      action: "CHATBOT_ACTION_EXECUTED",
      entityType: "ChatPendingAction",
      entityId: row.id,
      newValues: { action: row.action, via: "chatbot", interpretation: row.interpretation || "rule", intent: row.intent || null },
    }).catch(() => {});
  }
  await saveResultMessage(row, message);
  // A link the page opens client-side; the ticket page itself re-checks access.
  const navigationTarget = status === "EXECUTED" && ticketId ? { type: "route", path: `/tickets/${ticketId}`, label: "Open Ticket" } : null;
  // Show the ticket as it is now, through the same authorized, field-filtered summary tool
  // used for "summarize ticket"; any failure here must not change the result of the action.
  let summary = null;
  if (status === "EXECUTED" && ticketNumber) {
    try {
      const { runTool } = require("../tools");
      const { resolveRoleScope } = require("../roleScope");
      ({ summary } = await runTool("summarize_authorized_ticket", { scope: await resolveRoleScope(user), conversationId: row.conversationId }, { ticketNumber: String(ticketNumber) }));
    } catch {
      summary = null;
    }
  }
  return { actionId, status, message, ...(navigationTarget ? { navigationTarget } : {}), ...(summary ? { data: { summary } } : {}) };
}

// The user typed "yes" to the review of a ticket draft in THIS conversation. The same checks as
// the Confirm button apply (same user, same conversation, not expired, role re-checked, claimed once);
// only the confirmation token is replaced by the user's own typed reply. Never reachable over HTTP.
async function confirmTyped(user, conversationId, actionName) {
  const row = await prisma.chatPendingAction.findFirst({ where: { userId: user.id, conversationId, action: actionName, status: "PENDING", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!row) return null;
  return confirmAction(user, row.id, { typed: true, conversationId });
}

async function cancelAction(user, actionId, proof = {}) {
  const row = await loadOwnPending(user, actionId, proof);
  if (row.status !== "PENDING") return { actionId, status: row.status, message: row.resultMessage || STATUS_TEXT[row.status] };
  await prisma.chatPendingAction.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "CANCELLED", resolvedAt: new Date() } });
  await audit(user, row.conversationId, "ACTION_CANCELLED", row.id, "SUCCESS");
  // Cancelling the review of a ticket being raised also closes that draft (nothing is created).
  if (row.action === "raise_ticket_from_draft" && row.params?.draftId) {
    const store = require("../ticketDraft/draftStore");
    await store.setStatus(row.params.draftId, "CANCELLED").catch(() => {});
    await store.releaseFiles(row.params.draftId).catch(() => {});
  }
  const message = row.action === "raise_ticket_from_draft" ? "Okay, I've cancelled the ticket. Nothing was created." : "Cancelled. Nothing was changed.";
  await saveResultMessage(row, message);
  return { actionId, status: "CANCELLED", message };
}

// Typing "cancel" in chat may cancel this conversation's open proposal. Safe by
// nature (it only discards), so it does not need the token; it still requires
// the same admin and conversation.
async function cancelPendingInConversation(user, conversationId) {
  const row = await prisma.chatPendingAction.findFirst({ where: { userId: user.id, conversationId, status: "PENDING", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!row) return null;
  await prisma.chatPendingAction.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "CANCELLED", resolvedAt: new Date() } });
  await audit(user, conversationId, "ACTION_CANCELLED", row.id, "SUCCESS");
  return row;
}

async function hasPendingInConversation(user, conversationId) {
  const row = await prisma.chatPendingAction.findFirst({ where: { userId: user.id, conversationId, status: "PENDING", expiresAt: { gt: new Date() } } });
  return Boolean(row);
}

// Before asking for a missing reason or comment, run the rest of the request through the same rules
// (permission, ticket access, role operation), so something the user may not do is refused first
// instead of after they have typed a reason. Reads only; nothing is stored.
async function precheckAction(ctx, parsed) {
  const def = ACTIONS[parsed.action];
  if (!def || !parsed.args?.ticket) return;
  requireActionPermission(ctx.scope.user, parsed.action);
  const filled = { ...parsed.args };
  for (const f of parsed.missing || []) {
    if (!["reason", "comment", "description"].includes(f)) return;
    filled[f] = "(pending)";
  }
  await def.prepare({ actorId: ctx.scope.userId, user: ctx.scope.user, scope: ctx.scope, audit: async () => {} }, filled);
}

module.exports = { precheckAction, proposeAction, confirmAction, confirmTyped, cancelAction, cancelPendingInConversation, hasPendingInConversation, TTL_MS };
