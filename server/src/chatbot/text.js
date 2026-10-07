// Text helpers shared by DTO building, context building and input cleaning.

const NAMED_ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

// Ticket problem summaries / comments are stored as sanitized rich text
// (HTML). The chatbot only ever surfaces plain text, truncated.
function toPlainText(value, max = 500) {
  if (value === null || value === undefined) return null;
  let t = String(value)
    .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => NAMED_ENTITIES[m] ?? m);
  // eslint-disable-next-line no-control-regex
  t = t.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Cleans a user's chat message: strips control characters (keeps spaces),
// collapses whitespace, trims. Rendering is always as text, never HTML.
function cleanUserMessage(value) {
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

// Neutralizes our own context delimiters inside untrusted text so ticket
// content can't "close" the data block and masquerade as instructions.
function defang(value) {
  return String(value).replace(/<\/?\s*authorized_data\s*>/gi, "[removed]");
}

module.exports = { toPlainText, cleanUserMessage, defang };
