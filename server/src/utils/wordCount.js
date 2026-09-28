// Problem Summary is now rich text (see ticket.service.js's
// sanitizeRichText) — a bold/italic/underline/list-formatted entry must
// count only its VISIBLE words, never markup, so
// "<b>Unable</b> to access <i>Power BI</i>" counts as 5 words ("Unable to
// access Power BI"), not those words plus tag noise. Block-level tags
// (paragraphs, list items, line breaks) are turned into a single space
// FIRST so two adjacent blocks never glue together into one word (Quill
// emits list markup like "<li>First item</li><li>Second item</li>" with no
// whitespace between tags) — inline tags (b/i/u/etc.) are then dropped with
// no replacement, since they never separate otherwise-adjacent words.
function htmlToPlainText(html) {
  return (html || "")
    .replace(/<\/?(p|li|div|h[1-6]|blockquote|br)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

// Shared word-counting rule for Problem Summary (<=50 words) — used
// identically by ticket.validator.js (fast-fail layer) and
// ticket.service.js (authoritative layer) so the two can never disagree
// about what counts as a "word." Plain text with no HTML tags (every
// existing pre-rich-text ticket) passes through htmlToPlainText completely
// unchanged, so old tickets count exactly as they always did. Splits on any
// run of whitespace and drops empty segments, so leading/trailing/repeated
// spaces never inflate the count.
function countWords(text) {
  const trimmed = htmlToPlainText(text).trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const MAX_PROBLEM_SUMMARY_WORDS = 50;

module.exports = { countWords, MAX_PROBLEM_SUMMARY_WORDS };
