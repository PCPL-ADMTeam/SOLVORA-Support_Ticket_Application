// Short forms, explanations, ambiguity, the "not understood" fallback and follow-ups.
// Expectations come from the application's own services (see scenarios.js).
const { add, each, web, OPEN, status, prio, inDept, assignedTo, and, forbiddenFor, noWrite, outsideAccess, own } = require("./scenarios");
const { OUTSIDE_BI } = require("./data");
const { outcomeOf } = require("./harness");

const ROLES = ["EMPLOYEE", "TEAMLEAD", "MANAGER", "ADMIN"];
const jamie = (t) => t.assignee?.name === "Jamie User" || t.requester?.name === "Jamie User";

// ---- the short forms people type: a list, never a definition --------------------------------
const SHORT = [
  ["resolved tickets", status("RESOLVED")], ["closed tickets", status("CLOSED")], ["open tickets", OPEN], ["in progress tickets", status("IN_PROGRESS")],
  ["on hold tickets", status("ON_HOLD")], ["on hold", status("ON_HOLD")], ["in progress", status("IN_PROGRESS")], ["resolved", status("RESOLVED")], ["closed", status("CLOSED")], ["open", OPEN],
  ["any resolved tickets?", status("RESOLVED")], ["give me resolved tickets", status("RESOLVED")], ["show me resolved tickets", status("RESOLVED")],
  ["high priority tickets", prio("High")], ["high priority", prio("High")], ["high tickets", prio("High")], ["critical tickets", prio("Critical")],
  ["BI/Copilot tickets", inDept("BI/Copilot")],
];
each(ROLES, (role) => {
  for (const [text, pred] of SHORT) {
    add(role, "SHORT_FORMS", `Short form "${text}" is a ticket list`, { say: text, web: web(pred), allPages: true, intent: "list_tickets", suggest: `Show ${own(role)}${text.replace(/ tickets?$/, "")} tickets` });
  }
});
add("EMPLOYEE", "SHORT_FORMS", 'Short form "my tickets"', { say: "my tickets", web: web(() => true), allPages: true, intent: "list_tickets" });
add("EMPLOYEE", "SHORT_FORMS", 'Short form "my resolved tickets"', { say: "my resolved tickets", web: web(status("RESOLVED"), { scope: "created" }), allPages: true, intent: "list_tickets" });
each(["TEAMLEAD", "MANAGER"], (role) => {
  add(role, "SHORT_FORMS", 'Short form "department tickets"', { say: "department tickets", web: web(inDept("BI/Copilot")), allPages: true, intent: "list_tickets" });
  add(role, "SHORT_FORMS", 'Short form "Jamie tickets"', { say: "Jamie tickets", web: web(jamie), allPages: true, intent: "list_tickets" });
});
add("ADMIN", "SHORT_FORMS", 'Short form "Jamie tickets"', { say: "Jamie tickets", web: web(jamie), allPages: true, intent: "list_tickets" });
add("ADMIN", "SHORT_FORMS", 'Short form "Hardware tickets"', { say: "Hardware tickets", web: web(inDept("Hardware")), allPages: true, intent: "list_tickets" });
each(["EMPLOYEE", "TEAMLEAD", "MANAGER"], (role) => {
  add(role, "AUTHORIZATION", 'Short form "Hardware tickets" and "show HR tickets" are refused', [{ say: "Hardware tickets", outcome: "DENIED", noLeak: forbiddenFor(role) }, { say: "show HR tickets", outcome: "DENIED", noLeak: forbiddenFor(role) }]);
});
each(ROLES, (role) => {
  add(role, "SHORT_FORMS", 'Short form "my notifications"', { say: "my notifications", intent: "notifications", outcome: "DATA" });
  add(role, "SHORT_FORMS", 'Short form "unread notifications"', { say: "unread notifications", intent: "notifications", outcome: "DATA" });
  add(role, "SHORT_FORMS", 'Short form "my dashboard"', { say: "my dashboard", intent: "dashboard_summary", outcome: "DATA" });
});

// ---- explanations are only for explicit questions ------------------------------------------
each(ROLES, (role) => {
  for (const q of ["what does resolved mean?", "explain ticket statuses", "what does closed mean?"]) {
    add(role, "SHORT_FORMS", `Explanation: "${q}"`, { say: q, intent: "status_definition", outcome: "DATA" });
  }
  add(role, "AMBIGUOUS", '"What are resolved tickets?" asks whether the data or the meaning is wanted', {
    say: "What are resolved tickets?", intent: "status_or_list_question", outcome: "CLARIFY",
    check: (r) => ((r.suggestedActions || []).some((a) => /resolved tickets/i.test(a.prompt)) && (r.suggestedActions || []).some((a) => /mean/i.test(a.prompt)) ? null : "should offer both the ticket list and the meaning"),
  });
});

// ---- understood but empty is not "not understood" -----------------------------------------
add("EMPLOYEE", "FALLBACK_UX", "No resolved tickets: understood, no data (not 'not understood')", { say: "Show my resolved tickets", outcome: "NO_DATA", check: (r) => (/couldn't understand|can't help|not sure what you're looking for/i.test(r.message) ? "said it did not understand a request it understood" : null) });
each(["TEAMLEAD", "MANAGER", "ADMIN"], (role) => {
  add(role, "FALLBACK_UX", "Closed tickets in a department with none: understood, no data", { say: role === "ADMIN" ? "Show closed tickets in Cloud" : "Show closed tickets in BI/Copilot assigned to Jamie", outcome: "NO_DATA", check: (r) => (/couldn't understand|can't help|not sure what you're looking for/i.test(r.message) ? "said it did not understand a request it understood" : null) });
});

// ---- ambiguous, incomplete and unknown requests: a clear message and 3-5 working suggestions ----
each(ROLES, (role) => {
  const mustNotDefine = (r) => (/Understanding ticket|How assignment works/i.test(r.message) ? "answered with documentation instead of asking" : null);
  add(role, "FALLBACK_UX", '"show" alone: what would you like to see?', { say: "show", outcome: "CLARIFY", has: "What would you like to see?", suggestions: true, check: mustNotDefine });
  add(role, "FALLBACK_UX", '"Hardware" alone', role === "ADMIN" ? { say: "Hardware", outcome: "CLARIFY", has: "Hardware", suggestions: true } : { say: "Hardware", outcome: "DENIED", noLeak: forbiddenFor(role) });
  add(role, "FALLBACK_UX", '"BI/Copilot" alone offers what can be asked about it', { say: "BI/Copilot", outcome: "CLARIFY", has: "BI/Copilot", suggestions: true, not: role === "EMPLOYEE" ? ["employees in"] : [] });
  add(role, "FALLBACK_UX", '"Jamie" alone', role === "EMPLOYEE" ? { say: "Jamie", outcome: ["CLARIFY", "DENIED"], suggestions: true } : { say: "Jamie", outcome: ["CLARIFY", "DATA"], check: (r) => (/\?\s*$/.test(String(r.message).trim().split("\n")[0]) ? null : "did not ask what to know about Jamie") });
  for (const q of ["asdfghjkl", "Tell me something interesting.", "which tickets are getting annoying"]) {
    add(role, "FALLBACK_UX", `Unknown "${q}": says so and suggests`, { say: q, outcome: "UNSUPPORTED", has: "I'm not sure what you're looking for.", suggestions: true, check: (r) => (r.data?.tickets?.length ? "returned data for an unknown request" : mustNotDefine(r)) });
  }
});
// Role-aware: nothing is suggested that the role cannot do.
each(["EMPLOYEE"], (role) => add(role, "FALLBACK_UX", "Employee suggestions never offer department or people questions", { say: "asdfghjkl", outcome: "UNSUPPORTED", check: (r) => ((r.suggestedActions || []).some((a) => /department|employees|manager|unassigned/i.test(a.prompt)) ? "offered a question an Employee cannot ask" : null) }));
add("ADMIN", "FALLBACK_UX", "Admin suggestions never offer ticket operations an Admin cannot do", { say: "asdfghjkl", outcome: "UNSUPPORTED", check: (r) => ((r.suggestedActions || []).some((a) => /assign|reassign|transfer|raise/i.test(a.prompt)) ? "offered a ticket operation an Admin cannot do" : null) });

// ---- follow-ups and corrections keep what was understood -----------------------------------
add("EMPLOYEE", "CONVERSATION", "Follow-up: open tickets, then 'Show the resolved ones'", [{ say: "Show my open tickets", web: web(OPEN), allPages: false, check: () => null }, { say: "Show the resolved ones", web: web(status("RESOLVED")), allPages: true }]);
each(["TEAMLEAD", "MANAGER", "ADMIN"], (role) => {
  add(role, "CONVERSATION", "Follow-up: open tickets, then 'Show the resolved ones'", [{ say: "Show open tickets", outcome: "DATA" }, { say: "Show the resolved ones", web: web(status("RESOLVED")), allPages: true }]);
  add(role, "CONVERSATION", "Follow-up: BI/Copilot tickets, then 'Only resolved'", [{ say: "Show BI/Copilot tickets", web: web(inDept("BI/Copilot")), allPages: true }, { say: "Only resolved", web: web(and(inDept("BI/Copilot"), status("RESOLVED"))), allPages: true }]);
  add(role, "CONVERSATION", "Follow-up: Jamie's tickets, then 'Only open ones'", [{ say: "Show Jamie's tickets", web: web(jamie), allPages: true }, { say: "Only open ones", web: web(and(jamie, OPEN)), allPages: true }]);
  add(role, "CONVERSATION", "Corrections: department, then 'Actually BI/Copilot', 'Only open ones', 'No, assigned to Jamie'", [
    role === "ADMIN" ? { say: "Show Hardware tickets", web: web(inDept("Hardware")), allPages: true } : { say: "Show BI/Copilot tickets", web: web(inDept("BI/Copilot")), allPages: true },
    { say: "Actually BI/Copilot", web: web(inDept("BI/Copilot")), allPages: true },
    { say: "Only open ones", web: web(and(inDept("BI/Copilot"), OPEN)), allPages: true },
    { say: "No, assigned to Jamie", web: web(and(inDept("BI/Copilot"), OPEN, assignedTo("Jamie User"))), allPages: true },
  ]);
});

// ---- never beyond the user's access, even through a short form --------------------------------
each(["EMPLOYEE", "TEAMLEAD", "MANAGER"], (role) => {
  add(role, "SECURITY", "Short forms never list tickets outside the user's access", [{ say: "open tickets", noLeak: forbiddenFor(role).concat(OUTSIDE_BI.people), allPages: true, check: async (r, ctx, st) => outsideAccess(role, st.nums) || noWrite(ctx) }, { say: "resolved", noLeak: forbiddenFor(role), allPages: true, check: async (r, ctx, st) => outsideAccess(role, st.nums) }]);
});

void outcomeOf;

// ---- every way of asking for one person's tickets gives the same answer ----------------------
const JAMIE_PHRASES = ["show Jamie tickets", "Jamie tickets", "show Jamie's ticket", "show Jamie's tickets", "Jamie's tickets", "tickets of Jamie", "tickets for Jamie", "show Jamie User tickets", "list Jamie tickets", "Jamie User's tickets"];
each(["TEAMLEAD", "MANAGER", "ADMIN"], (role) => {
  for (const q of JAMIE_PHRASES) add(role, "NL_VARIATION", `One person, one answer: "${q}"`, { say: q, web: web(jamie), allPages: true, intent: "list_tickets", expectUnderstood: true, suggest: "Show Jamie's tickets" });
});
