// Helpers for the chatbot regression suite: send a message as a role, work out WHAT KIND of answer
// came back, compare it with what the application's own services say (the source of truth), and
// record a structured result per scenario. Nothing here changes business logic or authorization.
const ticketService = require("../../services/ticket.service");
const dashboardService = require("../../services/dashboard.service");
const notificationService = require("../../services/notification.service");
const service = require("../chatbot.service");
const { classify } = require("../intents/router");
const { WHO } = require("./data");

// ---- sending messages ------------------------------------------------------------------
const proofs = new Map();

// One chat message as `role`. Returns the response plus how long it took. A thrown ChatError is
// turned into the same shape the HTTP layer would send, so the checks below see what a user sees.
async function sendChatbotMessage(role, message, conversationId) {
  const user = typeof role === "string" ? WHO[role] : role;
  const started = process.hrtime.bigint();
  let r;
  try {
    r = await service.sendMessage(user, { message, conversationId });
  } catch (err) {
    r = { intent: "THROWN", message: err.message, error: { code: err.code || err.name }, data: {}, suggestedActions: [] };
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (r.pendingAction) proofs.set(r.pendingAction.id, { token: r.pendingAction.confirmationToken, conversationId: r.conversationId });
  return { r, ms };
}
const confirmPending = (role, id) => service.confirmAction(typeof role === "string" ? WHO[role] : role, id, proofs.get(id));

// ---- what kind of answer was it --------------------------------------------------------
const cardsOf = (r) => r.data?.tickets || r.data?.summaries || [];
const numsOf = (r) => cardsOf(r).map((t) => t.ticketNumber);
const blobOf = (r) => `${r.message}\n${JSON.stringify(r.data || {})}\n${JSON.stringify(r.suggestedActions || [])}`;

// DENIED: the role may not have this | NOT_FOUND: the neutral "no such ticket / no access" answer
// NO_DATA: searched, nothing matched | INVALID: malformed or impossible request
// UNSUPPORTED: not understood | CLARIFY: asks what was meant | PREVIEW: a change awaiting confirmation
// DATA: an answer that carries information
function outcomeOf(r) {
  const code = r.error?.code;
  const msg = String(r.message || "");
  if (r.pendingAction || r.responseType === "preview") return "PREVIEW";
  if (code === "CHAT_ACCESS_DENIED" || ["restricted_feature", "admin_redirect"].includes(r.intent) || /doesn't have access|do not have permission to|don't have access to/i.test(msg) && code !== "CHAT_TICKET_NOT_FOUND") return "DENIED";
  if (code === "CHAT_TICKET_NOT_FOUND") return "NOT_FOUND";
  if (code === "CHAT_NO_RESULTS") return "NO_DATA";
  if (code === "CHAT_UNSUPPORTED_INTENT" && /did you mean|what would you like to|not sure what you(?: want| would| 'd|'d)/i.test(msg)) return "CLARIFY";
  if (code === "CHAT_UNSUPPORTED_INTENT") return "UNSUPPORTED";
  if (["CHAT_INVALID_TICKET_ID", "CHAT_ACTION_INVALID", "CHAT_INVALID_TICKET_TRANSITION", "CHAT_INVALID_ROLE_OPERATION"].includes(code)) return "INVALID";
  if (code) return "ERROR";
  if (r.intent === "ticket_draft" || r.data?.ticketDraft) return "CLARIFY";
  if (["ticket_scope_question", "clarification_required"].includes(r.intent) || /^(which|do you want|what should|what is the reason|why are you|who should)\b/i.test(msg)) return "CLARIFY";
  if (/\byou have no\b|\bhas no comments\b|\bno (matching )?(tickets|notifications|comments)\b/i.test(msg)) return "NO_DATA";
  return "DATA";
}

// ---- the application as the source of truth ---------------------------------------------
async function getAccessibleTickets(role, query = {}) {
  const user = typeof role === "string" ? WHO[role] : role;
  const res = await ticketService.listTickets(user, { limit: 100, ...query });
  return res.data;
}
const numbers = (rows) => rows.map((t) => t.ticketNumber).sort();
const OPEN_GROUP = ["OPEN", "IN_PROGRESS", "ON_HOLD", "REOPENED"];
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1);

async function getExpectedTicketData(role, ticketNumber) {
  const rows = await getAccessibleTickets(role);
  return rows.find((t) => t.ticketNumber === String(ticketNumber)) || null;
}
async function getExpectedDashboardData(role, scope) {
  const stats = await dashboardService.getStats(typeof role === "string" ? WHO[role] : role, { scope, days: 30 });
  return { total: stats.kpis.total, byStatus: stats.byStatus, byPriority: stats.byPriority };
}
async function getExpectedUnread(role) {
  return notificationService.countUnread((typeof role === "string" ? WHO[role] : role).id);
}

// ---- checks (each returns a problem string, or null) ------------------------------------
const assertAccessDenied = (r) => (outcomeOf(r) === "DENIED" ? null : `expected access denied, got ${outcomeOf(r)} (${String(r.message).slice(0, 80)})`);
const assertNoUnauthorizedData = (r, forbidden) => {
  const blob = blobOf(r).toLowerCase();
  const hit = forbidden.filter((f) => blob.includes(String(f).toLowerCase()));
  return hit.length ? `leaked unauthorized data: ${hit.join(", ")}` : null;
};
const assertFilterMatchesBackend = (got, want) => (JSON.stringify([...got].sort()) === JSON.stringify([...want].sort()) ? null : `tickets differ: chatbot [${[...got].sort().join(",")}] vs backend [${[...want].sort().join(",")}]`);
const assertTicketMatchesBackend = (card, row) => {
  if (!card || !row) return "ticket missing on one side";
  const diffs = [];
  if (card.title !== row.title) diffs.push("title");
  if (card.status !== row.status) diffs.push("status");
  if ((card.priority?.name || card.priority) !== row.priority?.name) diffs.push("priority");
  if (card.department !== (row.toDepartment?.name || null)) diffs.push("department");
  if ((card.assignedTo || null) !== (row.assignee?.name || null)) diffs.push("assignee");
  if ((card.raisedBy || null) !== (row.requester?.name || null)) diffs.push("requester");
  return diffs.length ? `ticket ${row.ticketNumber} differs from the backend in: ${diffs.join(", ")}` : null;
};

// Pages of a list answer ("Show more"), the way a user would ask for them.
async function allPagesOf(role, first, ms) {
  let r = first;
  const out = [...numsOf(r)];
  let total = ms;
  for (let i = 0; i < 12 && (r.suggestedActions || []).some((a) => a.prompt === "Show more"); i += 1) {
    const next = await sendChatbotMessage(role, "Show more", r.conversationId);
    r = next.r;
    total += next.ms;
    out.push(...numsOf(r));
  }
  return { nums: [...new Set(out)], ms: total };
}

// Suggestions must be real, supported questions: each one has to be understood by the assistant.
function badSuggestions(r, roleName) {
  const chips = r.suggestedActions || [];
  if (!chips.length) return "no suggested questions were offered";
  const bad = chips.filter((c) => ["unsupported"].includes(classify(c.prompt || c.label, roleName).intent));
  return bad.length ? `suggestions the assistant itself cannot answer: ${bad.map((b) => b.prompt).join(" | ")}` : null;
}

// ---- running one scenario ---------------------------------------------------------------
// A step: { say, outcome, intent, tickets, web, allMatch, has, not, noLeak, suggestions, check, confirm }
async function runStep(sc, step, state, ctx) {
  const problems = [];
  const fail = (type, msg) => problems.push({ type, msg });
  const roleName = sc.role;
  const val = (v) => (typeof v === "function" ? v(ctx, state) : v);
  if (step.before) await step.before(ctx);
  const actor = sc.user || roleName;
  const say = val(step.say);
  let { r, ms } = await sendChatbotMessage(actor, say, state.cid);
  state.cid = r.conversationId || state.cid;
  const outcome = outcomeOf(r);

  if (step.allPages || step.tickets !== undefined || step.web) {
    const paged = await allPagesOf(actor, r, ms);
    state.nums = paged.nums;
    ms = paged.ms;
  } else state.nums = numsOf(r);

  if (step.outcome) {
    const allowed = [].concat(step.outcome);
    if (!allowed.includes(outcome)) {
      const securityLeak = allowed.includes("DENIED") && outcome === "DATA" && cardsOf(r).length > 0;
      fail(securityLeak ? "SECURITY" : allowed.includes("DENIED") ? "AUTHORIZATION" : ["UNSUPPORTED", "CLARIFY"].includes(outcome) ? "INTENT" : "DATA", `expected ${allowed.join(" or ")}, got ${outcome} (${String(r.message).replace(/\n/g, " / ").slice(0, 100)})`);
    }
  }
  if (step.intent && ![].concat(step.intent).includes(r.intent)) fail("INTENT", `expected intent ${[].concat(step.intent).join(" or ")}, got ${r.intent}`);
  if (step.tickets !== undefined) {
    const want = val(step.tickets);
    const p = assertFilterMatchesBackend(state.nums, want);
    if (p) fail(sc.category === "FILTERING" ? "FILTERING" : "DATA", p);
  }
  if (step.web) {
    const rows = await getAccessibleTickets(actor, step.web.query || {});
    const want = numbers(step.web.pred ? rows.filter(step.web.pred) : rows);
    const p = assertFilterMatchesBackend(state.nums, want);
    if (p) fail("FILTERING", p);
  }
  if (step.allMatch) {
    const bad = cardsOf(r).filter((c) => !step.allMatch(c));
    if (bad.length) fail("FILTERING", `returned tickets that do not satisfy the filter: ${bad.map((b) => b.ticketNumber).join(",")}`);
  }
  if (step.has) for (const s of [].concat(val(step.has))) if (!String(r.message).includes(s)) fail("FORMAT", `answer should contain "${s}"`);
  if (step.not) for (const s of [].concat(step.not)) if (String(r.message).toLowerCase().includes(String(s).toLowerCase())) fail("FORMAT", `answer must not contain "${s}"`);
  if (step.noLeak) {
    const p = assertNoUnauthorizedData(r, step.noLeak);
    if (p) fail("SECURITY", p);
  }
  if (step.suggestions) {
    const p = badSuggestions(r, roleName);
    if (p) fail("INTENT", p);
    // Three to five suggestions, and each one must really work for this user (never offer what is denied).
    const chips = r.suggestedActions || [];
    if (chips.length < 3 || chips.length > 5) fail("INTENT", "expected 3-5 suggestions, got " + chips.length);
    for (const chip of chips) {
      const tried = await sendChatbotMessage(actor, chip.prompt || chip.label);
      const o = outcomeOf(tried.r);
      if (!["DATA", "NO_DATA", "CLARIFY"].includes(o)) fail("INTENT", 'the suggestion "' + chip.prompt + '" does not work for this user (' + o + ")");
    }
  }
  if (step.check) {
    const p = await step.check(r, ctx, state);
    if (p) fail(step.checkType || "DATA", p);
  }
  if (step.confirm) {
    if (outcome !== "PREVIEW") fail("WORKFLOW", `expected a preview to confirm, got ${outcome}`);
    else {
      await confirmPending(actor, r.pendingAction.id);
      const p = await step.confirm(r, ctx);
      if (p) fail("WORKFLOW", p);
    }
  }
  return { say, outcome, intent: r.intent, code: r.error?.code || null, actual: `${String(r.message).replace(/\n/g, " / ").slice(0, 200)}${state.nums.length ? ` [tickets ${state.nums.join(",")}]` : ""}`, suggested: (r.suggestedActions || []).slice(0, 3).map((a) => a.prompt || a.label), ms, problems };
}

async function runScenario(sc, ctx = {}) {
  const state = { cid: undefined, nums: [] };
  const steps = [];
  for (const step of sc.steps) {
    const res = await runStep(sc, step, state, ctx);
    steps.push({ ...res, expectedOutcome: step.outcome ? [].concat(step.outcome).join("|") : null });
    if (res.problems.length) break;
  }
  const problems = steps.flatMap((s) => s.problems.map((p) => ({ ...p, query: s.say })));
  const last = steps[steps.length - 1];
  return {
    id: sc.id, name: sc.name, role: sc.role, category: sc.category, polarity: sc.polarity || "POSITIVE", dims: sc.dims || [],
    query: sc.steps.length > 1 ? steps.map((s) => s.say).join("  →  ") : steps[0].say,
    expected: sc.expected || steps.map((s) => s.expectedOutcome).filter(Boolean).join(" → ") || "answer consistent with the backend",
    actual: steps.length > 1 ? steps.map((s) => `${s.say}: ${s.outcome}`).join(" | ") : `${last.outcome}: ${last.actual}`,
    expectedIntent: [...sc.steps].reverse().find((s) => s.intent)?.intent || null,
    actualIntent: last.intent,
    expectedOutcome: last.expectedOutcome,
    actualOutcome: last.outcome,
    status: problems.length ? "FAIL" : "PASS",
    accuracy: problems.length ? 0 : 100,
    reason: problems.map((p) => p.msg).join("; "),
    failType: problems[0]?.type || null,
    security: problems.some((p) => p.type === "SECURITY"),
    suggestedQuery: sc.suggest || (problems.length ? last.suggested[0] || null : null),
    unknownQuery: problems.length > 0 && last.outcome === "UNSUPPORTED" && !String(last.expectedOutcome || "").includes("UNSUPPORTED"),
    responseTime: steps.reduce((s, x) => s + x.ms, 0),
    steps,
  };
}

module.exports = {
  sendChatbotMessage, confirmPending, outcomeOf, numsOf, cardsOf,
  getAccessibleTickets, getExpectedTicketData, getExpectedDashboardData, getExpectedUnread, numbers, OPEN_GROUP, monthStart,
  assertAccessDenied, assertNoUnauthorizedData, assertFilterMatchesBackend, assertTicketMatchesBackend, runScenario,
};
