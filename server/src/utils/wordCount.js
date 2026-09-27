// Shared word-counting rule for Problem Summary (<=50 words) — used
// identically by ticket.validator.js (fast-fail layer) and
// ticket.service.js (authoritative layer) so the two can never disagree
// about what counts as a "word." Splits on any run of whitespace and drops
// empty segments, so leading/trailing/repeated spaces never inflate the
// count.
function countWords(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const MAX_PROBLEM_SUMMARY_WORDS = 50;

module.exports = { countWords, MAX_PROBLEM_SUMMARY_WORDS };
