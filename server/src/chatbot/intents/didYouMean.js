const { normalizeMessage } = require("./aliases");
const { STOP } = require("./departmentRef");
const { REGISTRY } = require("../interpretation/intentRegistry");
const { SUGGESTIONS } = require("../suggestions");

// Layer 3: when no rule understands a message, don't dead-end. Offer the closest
// things this role can really ask (ranked by shared words, typo tolerant) and say
// which details were recognized. Every offered prompt is a normal question that
// goes through the same rules, scope checks and confirmations as if typed.

const tokens = (text) =>
  normalizeMessage(text)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

const same = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 1) || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

// Example prompts this role may use: its suggestions plus every registered intent's examples.
function catalog(role) {
  const out = new Set(SUGGESTIONS[role] || []);
  for (const def of REGISTRY.values()) {
    if (!def.roles?.includes(role)) continue;
    // Prompts that need a detail we don't have (a name or number) are not useful as one-click answers.
    for (const ex of def.examples || []) if (!/<|\d{4,}|\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(ex)) out.add(ex);
  }
  return [...out];
}

function rank(message, role, limit = 3) {
  const words = tokens(message);
  if (!words.length) return [];
  const scored = catalog(role).map((prompt) => {
    const pw = tokens(prompt);
    const shared = words.filter((w) => pw.some((p) => same(w, p))).length;
    return { prompt, score: shared / Math.sqrt(pw.length || 1) };
  });
  return scored.filter((s) => s.score >= 0.7).sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.prompt);
}

// What a message is roughly ABOUT, even when no rule understood it, mapped to the kind of question
// that fits (a question about people gets people questions; about counts gets count questions...).
const TOPICS = [
  [/\b(who|whom|person|people|manager|lead|employee|staff|colleague|handl\w*|look(?:ing)? after|working on|owner)\b/, /who|manager|team lead|employee|people|handling|assigned/i],
  [/\b(ticket|issue|problem|request|laptop|printer|vpn|bug|error|broken|not working)\b/, /ticket/i],
  [/\b(notif\w*|alert|unread|news|update\w*)\b/, /notification|what.?s new/i],
  [/\b(count|how many|number|total|stat\w*|summary|dashboard|report|chart)\b/, /how many|dashboard|summary|statistic/i],
  [/\b(comment|assign\w*|close|resolve\w*|reopen\w*|priority|status|transfer\w*|raise|create)\b/, /comment|assign|close|priority|status|transfer|raise|create/i],
  [/\b(department|team|dept)\b/, /department|team/i],
];

function related(message, role, limit = 4) {
  const m = normalizeMessage(message);
  const pool = catalog(role);
  const out = [];
  for (const [about, fits] of TOPICS) {
    if (!about.test(m)) continue;
    for (const p of pool) if (fits.test(p) && !out.includes(p)) out.push(p);
  }
  return out.slice(0, limit);
}

// Everyday questions per role: what is offered when nothing about the message points anywhere.
// Each one is a normal question that works for that role (the regression suite checks that).
const FALLBACK = {
  EMPLOYEE: ["Show my open tickets", "Show my resolved tickets", "Show tickets assigned to me", "Show my notifications"],
  TEAMLEAD: ["Show open tickets", "Show unassigned tickets", "Show tickets assigned to me", "Show my notifications"],
  MANAGER: ["Show my department tickets", "Show open tickets", "Show unassigned tickets", "Show my notifications"],
  ADMIN: ["Show open tickets", "How many tickets are in each department?", "Show departments", "Show my notifications"],
};
const fallbackSuggestions = (role) => FALLBACK[role] || FALLBACK.EMPLOYEE;

// What can be asked about a department, within what this role may do.
function departmentSuggestions(role, name) {
  const base = [`Show ${name} tickets`, `Show open ${name} tickets`];
  if (role === "EMPLOYEE") return base;
  return [...base, `Show employees in ${name}`, `Who is the manager of ${name}?`];
}

// found: the result of extractEntities (may be null).
const RECENT_WORDS = /\b(last time|recent|recently|earlier|before|previous|previously|lately|yesterday|ago)\b/;
function recentPrompts(role) {
  return role === "EMPLOYEE"
    ? ["Show my recent tickets", "Show my latest ticket", "Show my recent notifications", "Show tickets updated recently"]
    : ["Show tickets updated recently", "Show recently created tickets", "Show my latest ticket", "Show my recent notifications"];
}

function didYouMean({ message, role, found }) {
  const prompts = [];
  if (RECENT_WORDS.test(normalizeMessage(message))) prompts.push(...recentPrompts(role));
  if (found?.department) prompts.push(`Show tickets in ${found.department}`, `Show open tickets in ${found.department}`);
  else if (found?.priority) prompts.push(`Show ${found.priority} priority tickets`);
  for (const p of rank(message, role)) if (!prompts.includes(p)) prompts.push(p);
  // Nothing close by wording: offer questions about the same subject, then the role's everyday ones.
  if (prompts.length < 3) for (const p of related(message, role)) if (!prompts.includes(p) && prompts.length < 4) prompts.push(p);
  const noticed = found?.labels?.length ? ` I noticed: ${found.labels.join(", ")}.` : "";
  return { prompts: prompts.slice(0, 4), noticed };
}

module.exports = { didYouMean, rank, related, fallbackSuggestions, departmentSuggestions };
