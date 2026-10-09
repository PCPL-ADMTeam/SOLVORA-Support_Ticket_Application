const prisma = require("../../config/prisma");
const ticketService = require("../../services/ticket.service");
const userService = require("../../services/user.service");
const { countWords, MAX_PROBLEM_SUMMARY_WORDS } = require("../../utils/wordCount");
const { ChatError, CODES } = require("../chatbot.errors");
const { resolveDepartment, resolvePriority } = require("../actions/resolvers");
const { proposeAction, confirmTyped } = require("../actions/actionService");
const { extractEntities } = require("../entities/extract");
const { classify } = require("../intents/router");
const { cleanUserMessage } = require("../text");
const draftStore = require("./draftStore");
const { parseSlots, splitNames } = require("./slots");

// The conversational "Raise a Ticket". It only COLLECTS the details (title, priority, department,
// custom CC, problem summary, attachments), one message at a time or all at once, and shows a
// review. The ticket itself is created by ticket.service.createTicket, the same function the
// Raise a Ticket page uses, when the user confirms the review (see the raise_ticket_from_draft
// action). Priorities, departments and people are always looked up from the database; the
// "From Department" is derived by the ticket service's own rule, never typed or trusted.

const MAX_TITLE = 200;
const say = (message, extra = {}) => ({ message, data: {}, navigationTarget: null, suggestedActions: [], useModel: false, ticketNumbers: [], ...extra });
const chips = (labels, prefix = "") => labels.slice(0, 8).map((l) => ({ label: l, prompt: `${prefix}${l}` }));

const CANCEL = /^(?:please\s+)?(?:cancel|never ?mind|nevermind|stop|abort|discard|forget it|drop it)\b|\b(?:cancel|discard|drop|abort)\s+(?:the|this|my)\s+(?:ticket|request|draft)\b|^no,?\s*(?:please\s+)?(?:don'?t|do not)\s+(?:create|raise|submit)\b/i;
const CONFIRM = /^(?:yes|yep|yeah|y|ok|okay|sure|confirm|confirmed|go ahead|do it|proceed|raise it|create it|submit|submit it|please do|yes,?\s*(?:please\s+)?(?:raise|create|submit)(?:\s+it)?)\b[.!\s]*$/i;
const NO = /^(?:no|nope|nah|none|nothing|skip|not now|no thanks|no thank you|done|that'?s all|that is all|finished)\b[.!\s]*$/i;
const YES = /^(?:yes|yep|yeah|y|ok|okay|sure|please|i do|yes please)\b[.!\s]*$/i;

const priorityNames = async () => (await prisma.priority.findMany({ select: { name: true }, orderBy: { level: "asc" } })).map((p) => p.name);
const departmentNames = async () => (await prisma.department.findMany({ select: { name: true }, orderBy: { name: "asc" } })).map((d) => d.name);

async function dropPending(ctx) {
  await prisma.chatPendingAction.updateMany({ where: { userId: ctx.scope.userId, conversationId: ctx.conversationId, action: "raise_ticket_from_draft", status: "PENDING" }, data: { status: "CANCELLED", resolvedAt: new Date() } });
}

// ---- what the user sees ----------------------------------------------------
async function fromDepartmentName(user, f) {
  try {
    const id = await ticketService.resolveFromDepartmentId(user, undefined, f.toDepartmentId);
    const d = await prisma.department.findUnique({ where: { id }, select: { name: true } });
    return d?.name || null;
  } catch {
    return null;
  }
}

async function view(ctx, draft) {
  const f = draft.fields;
  return {
    id: draft.id,
    status: draft.status,
    step: draft.step,
    title: f.title || null,
    priority: f.priorityName || null,
    fromDepartment: f.toDepartmentId ? await fromDepartmentName(ctx.scope.user, f) : null,
    department: f.toDepartmentName || null,
    cc: (f.ccUsers || []).map((u) => (u.email ? `${u.name} (${u.email})` : u.name)),
    summary: f.problemSummary || null,
    words: f.problemSummary ? countWords(f.problemSummary) : 0,
    maxWords: MAX_PROBLEM_SUMMARY_WORDS,
    attachments: (draft.attachments || []).map((a) => ({ id: a.id, name: a.fileName, size: a.size, mimeType: a.mimeType })),
    limits: { maxFiles: ticketService.MAX_ATTACHMENTS_PER_TICKET, maxMb: ticketService.MAX_ATTACHMENTS_TOTAL_SIZE_MB },
    ccUsers: (f.ccUsers || []).map((u) => ({ id: u.id, name: u.name, email: u.email || null })),
    // The form is showing until the review: the real priorities and departments to pick from.
    ...(draft.step !== "REVIEW" ? { options: { priorities: await priorityNames(), departments: await departmentNames() } } : {}),
  };
}

const sizeText = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

async function reviewText(ctx, draft) {
  const v = await view(ctx, draft);
  return [
    "Ticket Review",
    "",
    `Title: ${v.title}`,
    `Priority: ${v.priority}`,
    `From Department: ${v.fromDepartment || "(set from your account)"}`,
    `Department: ${v.department}`,
    `Custom CC: ${v.cc.length ? v.cc.join(", ") : "None"}`,
    `Problem Summary: ${v.summary}`,
    `Attachments: ${v.attachments.length ? v.attachments.map((a, i) => `${i + 1}. ${a.name} (${sizeText(a.size)})`).join("; ") : "None"}`,
  ].join("\n");
}

// ---- applying what was said ---------------------------------------------------
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
async function resolveCcName(ctx, name, f) {
  // An email address must match a registered, active user exactly: CC is a list of people in the system.
  if (name.includes("@")) {
    if (!EMAIL.test(name)) return { problem: `"${name}" is not a valid email address.` };
    const found = await userService.searchActiveEmployees(name);
    const hit = found.find((u) => (u.email || "").toLowerCase() === name.toLowerCase());
    if (!hit) return { problem: `No active user has the email ${name}, so I could not add it to CC.` };
    if (hit.id === ctx.scope.userId) return { problem: "You are the one raising the ticket, so you don't need to CC yourself." };
    return { user: hit };
  }
  const hits = (await userService.searchActiveEmployees(name)).filter((u) => u.id !== ctx.scope.userId);
  const exact = hits.filter((u) => u.name.toLowerCase() === name.toLowerCase());
  const pool = exact.length ? exact : hits;
  if (pool.length === 1) return { user: pool[0] };
  if (!pool.length) return { problem: `I couldn't find an active person called "${name}" to CC.` };
  return { options: pool.slice(0, 6) };
}

// Mutates `f` (the draft's fields); returns notes (what was understood) and problems (what was not).
async function applySlots(ctx, draft, slots) {
  const f = draft.fields;
  const notes = [];
  const problems = [];
  if (slots.title) {
    if (slots.title.length > MAX_TITLE) problems.push(`The title can be at most ${MAX_TITLE} characters. Please shorten it.`);
    else (f.title = slots.title), notes.push(`title "${f.title}"`);
  }
  if (slots.priority) {
    try {
      const p = await resolvePriority(slots.priority);
      Object.assign(f, { priorityId: p.id, priorityName: p.name });
      notes.push(`${p.name} priority`);
    } catch (err) {
      problems.push(err.message);
    }
  }
  if (slots.departmentText) {
    try {
      const d = await resolveDepartment(slots.departmentText);
      Object.assign(f, { toDepartmentId: d.id, toDepartmentName: d.name });
      notes.push(`department ${d.name}`);
    } catch (err) {
      problems.push(err.message);
    }
  }
  if (slots.description) {
    const n = countWords(slots.description);
    if (n > MAX_PROBLEM_SUMMARY_WORDS) problems.push(`The problem summary is limited to ${MAX_PROBLEM_SUMMARY_WORDS} words. Please shorten it. (You wrote ${n}.)`);
    else (f.problemSummary = slots.description), notes.push("problem summary");
  }
  for (const name of slots.ccAdd) {
    const r = await resolveCcName(ctx, name, f);
    if (r.user) {
      f.ccUsers = f.ccUsers || [];
      if (f.ccUsers.some((u) => u.id === r.user.id)) problems.push(`${r.user.name} is already in CC.`);
      else f.ccUsers.push({ id: r.user.id, name: r.user.name, email: r.user.email || null }), notes.push(`CC ${r.user.name}${r.user.email ? ` (${r.user.email})` : ""}`);
      f.ccDone = true;
    } else if (r.options) {
      f.choice = { kind: "cc", name, options: r.options.map((u) => ({ id: u.id, name: u.name, email: u.email || null, label: `${u.name}${u.email ? ` <${u.email}>` : ""}${u.department?.name ? ` (${u.department.name})` : ""}` })), rest: slots.ccAdd.slice(slots.ccAdd.indexOf(name) + 1) };
      return { notes, problems, ask: true };
    } else problems.push(r.problem);
  }
  for (const name of slots.ccRemove) {
    const before = (f.ccUsers || []).length;
    f.ccUsers = (f.ccUsers || []).filter((u) => !(u.name.toLowerCase().includes(name.toLowerCase()) || (u.email && u.email.toLowerCase() === name.toLowerCase())));
    if (f.ccUsers.length < before) notes.push(`removed ${name} from CC`);
    else problems.push(`${name} is not in the CC list.`);
  }
  if (slots.noCc) f.ccDone = true;
  if (slots.noFiles) f.attachDone = true;
  return { notes, problems };
}

// ---- what to ask next --------------------------------------------------------
function nextStep(f, draft) {
  if (!f.title) return "TITLE";
  if (!f.priorityId) return "PRIORITY";
  if (!f.toDepartmentId) return "DEPARTMENT";
  if (!f.problemSummary) return "SUMMARY";
  // Custom CC and attachments are optional and live in the form and the review: never a separate question.
  return "REVIEW";
}

async function prompt(ctx, draft, step, { first = false } = {}) {
  const f = draft.fields;
  // Optional questions (CC, files) follow only the first time through; after a review, an edit goes straight back to it.
  if (!f.reviewedOnce) f.asked = true;
  const base = { data: { ticketDraft: await view(ctx, { ...draft, step }) } };
  switch (step) {
    case "TITLE":
      return say(first ? "Sure. I'll help you raise a support ticket. Fill in the form below: title, priority, department and problem summary. CC people and files are optional. What is the issue title?" : "What is the issue title?", base);
    case "PRIORITY": {
      const names = await priorityNames();
      return say(`What priority should this ticket have? (${names.join(", ")})`, base);
    }
    case "DEPARTMENT": {
      const names = await departmentNames();
      return say("Which department should handle this ticket?", base);
    }
    case "SUMMARY":
      return say(`Please describe the problem (up to ${MAX_PROBLEM_SUMMARY_WORDS} words).`, base);
    case "CC":
      return say("Do you want to add anyone in CC? Give their names or email addresses (several are fine, separated by commas), or say no.", { ...base, suggestedActions: [{ label: "No CC", prompt: "No custom CC" }] });
    case "ATTACH":
      return say(`Do you want to attach any files? Use the attach button, or paste a screenshot here (up to ${ticketService.MAX_ATTACHMENTS_PER_TICKET} files, ${ticketService.MAX_ATTACHMENTS_TOTAL_SIZE_MB} MB in total). Say no to continue without files.`, { ...base, suggestedActions: [{ label: "No attachments", prompt: "No attachments" }] });
    default:
      return null;
  }
}

async function review(ctx, draft) {
  await dropPending(ctx);
  draft.fields.reviewedOnce = true;
  await draftStore.save(draft.id, { fields: draft.fields });
  let pending;
  try {
    pending = await proposeAction(ctx, { action: "raise_ticket_from_draft", args: { draftId: draft.id } }, { method: ctx.method || "rule", intent: "ticket_draft" });
  } catch (err) {
    if (err instanceof ChatError && err.code === CODES.ACTION_INVALID) return say(`${err.message}`, { data: { ticketDraft: await view(ctx, draft) } });
    throw err;
  }
  const text = await reviewText(ctx, draft);
  return say(`${text}\n\nPlease confirm if I should raise this ticket.`, {
    data: {
      ticketDraft: await view(ctx, { ...draft, step: "REVIEW" }),
      pendingAction: { id: pending.id, title: pending.title, summary: pending.summary, impact: pending.impact, expiresAt: pending.expiresAt, confirmationToken: pending.confirmationToken },
    },
  });
}

// Save, then either ask the next question or show the review.
async function advance(ctx, draft, { preface = "", first = false } = {}) {
  const step = nextStep(draft.fields, draft);
  const saved = await draftStore.save(draft.id, { fields: draft.fields, step });
  if (step === "REVIEW") {
    const r = await review(ctx, saved);
    return { ...r, message: `${preface ? `${preface}\n\n` : ""}${r.message}` };
  }
  const r = await prompt(ctx, saved, step, { first });
  // `prompt` flags that questions were asked (so optional ones follow): persist it.
  await draftStore.save(saved.id, { fields: saved.fields });
  return { ...r, message: `${preface ? `${preface} ` : ""}${r.message}` };
}

const understood = (notes) => (notes.length ? `Got it: ${notes.join(", ")}.` : "");
const problemText = (problems) => problems.join(" ");

// ---- entry points ---------------------------------------------------------------
async function start(ctx, message) {
  if (ctx.scope.role === "ADMIN") throw new ChatError(CODES.ACCESS_DENIED, { message: "You don't have permission to raise a ticket.", internal: "admin raise ticket" });
  const draft = await draftStore.create(ctx.scope.userId, ctx.conversationId, { ccUsers: [] });
  const slots = await parseSlots(message);
  // "I have a laptop issue": a problem statement with no command in it is the start of the summary.
  if (!slots.description && /^(?:i\s+(?:have|am having|'m having|got)|my\s+\w+|there(?:'s| is))\b/i.test(message) && countWords(message) <= MAX_PROBLEM_SUMMARY_WORDS && !/\b(?:ticket|raise|create)\b/i.test(message)) slots.description = message.trim();
  const { notes, problems, ask } = await applySlots(ctx, draft, slots);
  if (ask) return choicePrompt(ctx, draft, notes);
  const anyGiven = notes.length > 0;
  const r = await advance(ctx, draft, { preface: [understood(notes), problemText(problems)].filter(Boolean).join(" "), first: !anyGiven });
  return r;
}

async function choicePrompt(ctx, draft, notes) {
  const c = draft.fields.choice;
  await draftStore.save(draft.id, { fields: draft.fields, step: "CC" });
  const list = c.options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  return say(`${understood(notes) ? `${understood(notes)} ` : ""}More than one person matches "${c.name}". Which one should I CC? Reply with the number.\n${list}`, {
    data: { ticketDraft: await view(ctx, draft) },
    suggestedActions: c.options.map((o, i) => ({ label: o.label, prompt: String(i + 1) })),
  });
}

function wantsEdit(m) {
  return /\b(?:edit|change|update|modify|correct|rewrite|redo|fix)\b/i.test(m);
}

const FIELD_WORDS = [
  ["PRIORITY", /\bpriority\b/i],
  ["DEPARTMENT", /\b(?:department|dept|team)\b/i],
  ["TITLE", /\b(?:title|subject)\b/i],
  ["SUMMARY", /\b(?:problem|summary|description|details?|issue)\b/i],
  ["CC", /\bcc\b/i],
  ["ATTACH", /\b(?:attachments?|screenshots?|files?|images?)\b/i],
];

async function handleTurn(ctx, draft, rawMessage) {
  const message = cleanUserMessage(rawMessage);
  const f = draft.fields;

  // Cancel the ticket (never creates anything).
  if (CANCEL.test(message)) {
    await dropPending(ctx);
    await draftStore.setStatus(draft.id, "CANCELLED");
    await draftStore.releaseFiles(draft.id);
    return say("Okay, I've cancelled the ticket. Nothing was created.", { data: { ticketDraftClosed: true } });
  }

  // Typed confirmation of the review that is on screen (only the one for this conversation).
  if (CONFIRM.test(message)) {
    const done = await confirmTyped(ctx.scope.user, ctx.conversationId, "raise_ticket_from_draft");
    if (done) {
      return say(done.message, { data: { ...(done.data || {}), resolvedAction: { id: done.actionId, status: done.status }, ...(done.status === "EXECUTED" ? { ticketDraftClosed: true } : {}) }, navigationTarget: done.navigationTarget || null });
    }
    if (nextStep(f, draft) === "REVIEW") return advance(ctx, draft, { preface: "Here is the ticket again." });
  }
  if (draft.step === "REVIEW" && /^(?:no|nope|nah)\b[.!\s]*$/i.test(message)) {
    await dropPending(ctx);
    await draftStore.save(draft.id, { step: "REVIEW" });
    return say("Okay, I haven't created it. Tell me what to change (title, priority, department, CC, problem summary or attachments), or say cancel.");
  }

  // Not about the ticket at all (a question about other data): leave the draft and answer normally.
  const looksLikeQuestion = /^(?:show|list|who|how many|what|when|where|which|give me|tell me)\b/i.test(message) && !wantsEdit(message);
  if (looksLikeQuestion && draft.step !== "TITLE" && draft.step !== "SUMMARY") {
    const det = classify(message, ctx.scope.role);
    if (det.confidence === "high" && det.intent !== "unsupported") return null;
  }
  if (looksLikeQuestion && (draft.step === "TITLE" || draft.step === "SUMMARY")) {
    const det = classify(message, ctx.scope.role);
    if (det.confidence === "high" && ["list_tickets", "find_ticket", "dashboard_summary", "notifications", "people_directory"].includes(det.intent)) return null;
  }

  // A pending choice (several people matched a CC name).
  if (f.choice) {
    const n = message.match(/^(?:option\s*|number\s*|#)?(\d{1,2})\.?$/);
    const opt = n ? f.choice.options[Number(n[1]) - 1] : f.choice.options.find((o) => o.label.toLowerCase() === message.toLowerCase() || o.name.toLowerCase() === message.toLowerCase());
    if (!opt) return say(`Please pick one of the numbers shown, or say cancel.`, { data: { ticketDraft: await view(ctx, draft) } });
    await dropPending(ctx);
    f.ccUsers = [...(f.ccUsers || []).filter((u) => u.id !== opt.id), { id: opt.id, name: opt.name, email: opt.email || null }];
    f.ccDone = true;
    const rest = f.choice.rest || [];
    delete f.choice;
    if (rest.length) {
      const again = await applySlots(ctx, draft, { title: null, priority: null, departmentText: null, description: null, ccAdd: rest, ccRemove: [], noCc: false, noFiles: false });
      if (again.ask) return choicePrompt(ctx, draft, [`CC ${opt.name}`, ...again.notes]);
    }
    return advance(ctx, draft, { preface: `Got it: CC ${opt.name}.` });
  }

  // A pending choice among attachments to remove.
  if (f.removing) {
    const n = message.match(/^(?:option\s*|number\s*|#)?(\d{1,2})\.?$/);
    const target = n ? (draft.attachments || [])[Number(n[1]) - 1] : null;
    delete f.removing;
    if (target) {
      await dropPending(ctx);
      await draftStore.removeFile(draft, target.id);
      const fresh = await draftStore.save(draft.id, { fields: f });
      return advance(ctx, fresh, { preface: `Removed ${target.fileName}.` });
    }
  }

  await dropPending(ctx);
  const slots = await parseSlots(message, { requirePriorityWord: draft.step !== "PRIORITY" });
  const wasEdit = wantsEdit(message);

  // "Change X" with no new value: ask for X and keep everything else.
  if (wasEdit) {
    const hit = FIELD_WORDS.find(([, re]) => re.test(message));
    const hasValue = Boolean(slots.title || slots.priority || slots.departmentText || slots.description || slots.ccAdd.length || slots.ccRemove.length);
    if (hit && !hasValue && hit[0] !== "ATTACH" && hit[0] !== "CC") {
      const asked = { TITLE: "title", PRIORITY: "priority", DEPARTMENT: "department", SUMMARY: "problem summary" }[hit[0]];
      if (hit[0] === "TITLE") delete f.title;
      if (hit[0] === "PRIORITY") (delete f.priorityId, delete f.priorityName);
      if (hit[0] === "DEPARTMENT") (delete f.toDepartmentId, delete f.toDepartmentName);
      if (hit[0] === "SUMMARY") delete f.problemSummary;
      await draftStore.save(draft.id, { fields: f, step: hit[0] });
      const r = await prompt(ctx, { ...draft, step: hit[0] }, hit[0]);
      await draftStore.save(draft.id, { fields: f });
      return { ...r, message: `Okay, let's change the ${asked}. ${r.message}` };
    }
    if (hit && hit[0] === "CC" && !hasValue) {
      f.ccDone = false;
      f.ccUsers = [];
      await draftStore.save(draft.id, { fields: f, step: "CC" });
      return prompt(ctx, { ...draft, step: "CC" }, "CC");
    }
    if (!hit) return formReply(ctx, draft, "Okay, edit your ticket in the form below. Everything you entered is kept.");
  }

  // Removing an attachment by words.
  if (/\b(?:remove|delete|drop|take off)\b/i.test(message) && /\b(?:attachments?|screenshots?|files?|images?)\b|\.\w{2,4}\b/i.test(message)) {
    const files = draft.attachments || [];
    if (!files.length) return say("There are no attachments on this ticket.", { data: { ticketDraft: await view(ctx, draft) } });
    const byName = files.find((a) => message.toLowerCase().includes(a.fileName.toLowerCase()));
    const num = message.match(/\b(\d{1,2})\b/);
    const target = byName || (num ? files[Number(num[1]) - 1] : null) || (files.length === 1 ? files[0] : null);
    if (!target) {
      f.removing = true;
      await draftStore.save(draft.id, { fields: f });
      return say(`Which attachment should I remove? Reply with the number.\n${files.map((a, i) => `${i + 1}. ${a.fileName}`).join("\n")}`, { data: { ticketDraft: await view(ctx, draft) } });
    }
    await draftStore.removeFile(draft, target.id);
    const fresh = await draftStore.save(draft.id, { fields: f });
    return advance(ctx, fresh, { preface: `Removed ${target.fileName}.` });
  }

  // The step's own answer, when the message did not name the field.
  const step = draft.step;
  if (step === "TITLE" && !slots.title) slots.title = message.replace(/^["“']|["”']$/g, "").trim();
  if (step === "PRIORITY" && !slots.priority) {
    const found = await extractEntities(message, { visibleDepartments: [] });
    slots.priority = found.priority;
    if (!slots.priority) {
      const names = await priorityNames();
      return say(`I couldn't match that to a priority. What priority should I use? (${names.join(", ")})`, { data: { ticketDraft: await view(ctx, draft) }, suggestedActions: chips(names) });
    }
  }
  if (step === "DEPARTMENT" && !slots.departmentText) slots.departmentText = message.replace(/^(?:department\s*(?:is|:)?|send it to|to|for|i want|use)\s+/i, "").replace(/[.!?]+$/, "").trim();
  if (step === "SUMMARY" && !slots.description) slots.description = message;
  if (step === "CC" && !slots.ccAdd.length && !slots.noCc && !slots.ccRemove.length) {
    if (NO.test(message)) slots.noCc = true;
    else slots.ccAdd = splitNames(message);
  }
  // The form is open and the message names nothing it could use: point at the form rather than guess.
  if (step === "FORM" && !slots.title && !slots.priority && !slots.departmentText && !slots.description && !slots.ccAdd.length && !slots.ccRemove.length && !slots.noCc && !slots.noFiles) {
    return formReply(ctx, draft, 'Please use the form below, or tell me what to change (for example: "priority high").');
  }
  if (step === "ATTACH") {
    if (NO.test(message) || slots.noFiles) f.attachDone = true;
    else if (YES.test(message)) return say(`Use the attach button (or paste a screenshot) to add files. Say done when you have finished, or no to continue without files.`, { data: { ticketDraft: await view(ctx, draft) } });
  }

  const { notes, problems, ask } = await applySlots(ctx, draft, slots);
  if (ask) return choicePrompt(ctx, draft, notes);
  // Saying something at the review that changed nothing is not an answer: ask what to change.
  if (!notes.length && !problems.length && step === "REVIEW") {
    return say("I didn't catch a change. Tell me what to change, or say cancel.", { data: { ticketDraft: await view(ctx, draft) } });
  }
  return advance(ctx, draft, { preface: [understood(notes), problemText(problems)].filter(Boolean).join(" ") });
}

const invalid = (message) => new ChatError(CODES.ACTION_INVALID, { message });

// The form again, with everything entered so far (used by Edit on the review).
async function formReply(ctx, draft, preface) {
  await dropPending(ctx);
  const saved = await draftStore.save(draft.id, { fields: draft.fields, step: "FORM" });
  return say(preface, { data: { ticketDraft: await view(ctx, saved) } });
}

// Custom CC arrives as user ids chosen in the form. They are checked against real, active users here (and
// again by the ticket service when the ticket is raised); the requester is never added to their own CC.
async function resolveCcIds(ctx, ids) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x)).filter(Boolean))];
  if (unique.length > 20) throw invalid("You can add at most 20 people in CC.");
  if (!unique.length) return [];
  if (unique.includes(ctx.scope.userId)) throw invalid("You are raising the ticket, so you don't need to CC yourself.");
  const rows = await prisma.user.findMany({ where: { id: { in: unique }, isActive: true }, select: { id: true, name: true, email: true } });
  if (rows.length !== unique.length) throw invalid("One or more of the people you chose for CC are not valid active users. Please change the CC list.");
  return unique.map((id) => rows.find((r) => r.id === id)).map((u) => ({ id: u.id, name: u.name, email: u.email || null }));
}

// The form's "Review Ticket": every field in one request, validated with the same rules as typed answers,
// then the review (the only place a ticket can be raised from). Nothing is created here.
async function submitForm(ctx, draft, payload = {}) {
  const f = draft.fields;
  const text = (v) => (typeof v === "string" ? cleanUserMessage(v) : "");
  const title = text(payload.title);
  const priority = text(payload.priority);
  const department = text(payload.department);
  const summary = typeof payload.problemSummary === "string" ? payload.problemSummary.replace(/\s+/g, " ").trim() : "";
  const missing = [["Title", title], ["Priority", priority], ["Department", department], ["Problem Summary", summary]].filter(([, v]) => !v).map(([l]) => l);
  if (missing.length) throw invalid(`Please fill in: ${missing.join(", ")}.`);
  const ccUsers = await resolveCcIds(ctx, payload.ccUserIds);
  const { problems } = await applySlots(ctx, draft, { title, priority, departmentText: department, description: summary, ccAdd: [], ccRemove: [], noCc: false, noFiles: false });
  f.ccUsers = ccUsers;
  // What was valid is kept, so nothing the user entered is lost when one field is refused.
  await draftStore.save(draft.id, { fields: f });
  if (problems.length) throw invalid(problems.join(" "));
  return advance(ctx, draft, {});
}

// Called after files were added or removed through the upload endpoint.
async function afterFilesChanged(ctx, draft, preface) {
  await dropPending(ctx);
  const fresh = await draftStore.getActive(ctx.scope.userId, ctx.conversationId);
  fresh.fields.attachDone = true;
  return advance(ctx, fresh, { preface });
}

module.exports = { start, handleTurn, afterFilesChanged, view, submitForm, formReply };
