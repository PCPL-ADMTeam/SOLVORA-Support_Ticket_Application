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

// found: the result of extractEntities (may be null).
function didYouMean({ message, role, found }) {
  const prompts = [];
  if (found?.department) prompts.push(`Show tickets in ${found.department}`, `Show open tickets in ${found.department}`);
  else if (found?.priority) prompts.push(`Show ${found.priority} priority tickets`);
  for (const p of rank(message, role)) if (!prompts.includes(p)) prompts.push(p);
  const noticed = found?.labels?.length ? ` I noticed: ${found.labels.join(", ")}.` : "";
  return { prompts: prompts.slice(0, 4), noticed };
}

module.exports = { didYouMean, rank };
