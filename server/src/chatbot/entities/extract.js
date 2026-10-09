const prisma = require("../../config/prisma");
const { matchDepartments } = require("../departmentMatch");
const { normalizeMessage } = require("../intents/aliases");
const { extractDateRange } = require("./dates");

// Layer 1: read the DETAILS out of a message using the system's real values
// (this user's visible departments, the priorities in the database, the fixed
// ticket statuses, relative dates). Deterministic, no AI, and it only reads the
// user's own words: what it returns is a set of candidate filters. The handler
// still validates them and the ticket tool still restricts the rows to what the
// caller may see, so a mention can narrow a result but never widen it.

// Plain-language words for each status. "open" is handled by the router's filters.
const STATUS_WORDS = [
  ["ON_HOLD", /\b(on hold|on-hold|waiting|paused)\b/],
  ["IN_PROGRESS", /\b(in progress|in-progress|ongoing|being worked on|started)\b/],
  ["RESOLVED", /\b(resolved|solved|fixed|completed|done)\b/],
  ["CLOSED", /\bclosed\b/],
  ["REOPENED", /\b(reopened|re-opened)\b/],
];
const STATUS_LABEL = { ON_HOLD: "On Hold", IN_PROGRESS: "In Progress", RESOLVED: "Resolved", CLOSED: "Closed", REOPENED: "Reopened" };

// Everyday words that mean one of the configured priorities. Only used when
// such a priority exists in the database.
const PRIORITY_SYNONYMS = [
  [/\b(urgent|emergency|asap|blocker|showstopper)\b/, ["Critical", "High"]],
  [/\b(important|serious|severe)\b/, ["High"]],
  [/\b(normal|moderate|standard)\b/, ["Medium"]],
  [/\b(minor|trivial|low-priority)\b/, ["Low"]],
];

function findPriority(m, priorities) {
  const names = priorities.map((p) => p.name);
  for (const n of names) {
    if (new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b(?:\\s+priority)?`).test(m)) return n;
  }
  for (const [re, wanted] of PRIORITY_SYNONYMS) {
    if (re.test(m)) {
      const hit = wanted.find((w) => names.some((n) => n.toLowerCase() === w.toLowerCase()));
      if (hit) return names.find((n) => n.toLowerCase() === hit.toLowerCase());
    }
  }
  return null;
}

// visibleDepartments: names the caller may see, or null for "all" (Admin).
async function extractEntities(message, { visibleDepartments = null, now = new Date() } = {}) {
  const m = normalizeMessage(message);
  const out = { department: null, priority: null, status: null, dateFrom: null, dateTo: null, labels: [] };

  // Departments: fuzzy (typos, spacing, "bi copilot" = BICopilot). Very short names
  // (e.g. "IT") are not guessed from a loose word because they are also ordinary words.
  const all = visibleDepartments || (await prisma.department.findMany({ select: { name: true } })).map((d) => d.name);
  const candidates = all.filter((n) => String(n).replace(/[^a-z0-9]/gi, "").length >= 3);
  // "open support tickets" describes the kind of ticket; it is not the "IT Support" department.
  const forDepartments = m.replace(/\b(?:support|help|helpdesk|service|request|issue)s?\b(?=\s+(?:tickets?|requests?|issues?)\b)/g, " ");
  const hits = matchDepartments(forDepartments, candidates);
  if (hits.length === 1) out.department = hits[0];

  const priorities = await prisma.priority.findMany({ select: { name: true }, orderBy: { level: "asc" } });
  out.priority = findPriority(m, priorities);

  for (const [status, re] of STATUS_WORDS) {
    if (re.test(m)) {
      out.status = status;
      break;
    }
  }

  const range = extractDateRange(m, now);
  if (range?.ambiguous) out.dateAmbiguous = true;
  else if (range) Object.assign(out, { dateFrom: range.from, dateTo: range.to, dateLabel: range.label });

  if (out.department) out.labels.push(`department ${out.department}`);
  if (out.priority) out.labels.push(`${out.priority} priority`);
  if (out.status) out.labels.push(`status ${STATUS_LABEL[out.status]}`);
  if (out.dateLabel) out.labels.push(out.dateLabel);
  return out;
}

module.exports = { extractEntities, STATUS_LABEL };
