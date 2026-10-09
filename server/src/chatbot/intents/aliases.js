// Synonym and common-misspelling normalization for the RULE engine. It lets
// "shw tikets for all depts" and "how many open issues does each dept have"
// hit the same deterministic rules as the canonical wording, so the model is
// not needed (or paid for) for them. Applied to a lower-cased COPY used for
// keyword rules only; ticket references and names are always read from the
// original text.

const WORD_ALIASES = [
  [/\bshw\b|\bshwo\b|\bdisplay\b/g, "show"],
  [/\b(?:tikets?|tickts?|tikcets?|ticktes|tckts?|tkts|ticketss)\b/g, (m) => (/s$/.test(m) ? "tickets" : "ticket")],
  // "tkt" only when it is not part of a reference like TKT-1024
  [/\btkt\b(?![-\s]?\d)/g, "ticket"],
  [/\b(?:depts|deptartments|departmnts|depatments|departmetns|deparments|departmens|deprtments)\b/g, "departments"],
  [/\b(?:dept|deparment|deprtment|departmet|depatment|deptartment)\b/g, "department"],
  [/\bissues\b/g, "tickets"],
  [/\bissue\b/g, "ticket"],
  [/\b(?:unresolved|outstanding|incomplete|not closed|not resolved|still open)\b/g, "open"],
  // "onhold", "on_hold", "inprogress": one spelling for the status words.
  [/\bon[_-]?hold\b/g, "on hold"],
  [/\bin[_-]?progress\b/g, "in progress"],
  // A correction or filler at the start: "actually show X", "instead show X", "no wait, show X".
  [/^(?:actually|instead|rather|sorry|no wait|wait|ok(?:ay)?|hmm+|um+)\b[,:]?\s+/g, ""],
  [/\bemps\b/g, "employees"],
  [/\bemp\b/g, "employee"],
  [/\b(?:mngrs|mgrs)\b/g, "managers"],
  [/\b(?:mngr|mgr)\b/g, "manager"],
  [/\bbreak[- ]?(?:up|down)\b/g, "breakdown"],
  [/\b(?:plz|pls|please|kindly)\b/g, ""],
];

function normalizeMessage(text) {
  let t = String(text).toLowerCase();
  for (const [re, to] of WORD_ALIASES) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}

module.exports = { normalizeMessage };
