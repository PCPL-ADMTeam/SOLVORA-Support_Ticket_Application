const sanitizeHtml = require("sanitize-html");

// Applied server-side to any user-authored rich text (ticket comments)
// before it's persisted — the client also sanitizes on render, but the API
// must never trust that every future consumer will.
function sanitizeRichText(html) {
  return sanitizeHtml(html || "", {
    allowedTags: ["p", "br", "strong", "em", "u", "s", "ol", "ul", "li", "a", "h1", "h2", "h3", "blockquote", "code", "pre", "span"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
  });
}

// Strips HTML entirely rather than allow-listing it — every tag is removed;
// only whitespace is normalized (collapsed/trimmed) beyond that. No longer
// used for Ticket.problemSummary (see sanitizeRichText above, used there
// since that field became a rich-text editor); kept as a general-purpose
// plain-text sanitizer.
function sanitizePlainText(value) {
  return sanitizeHtml(value || "", { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
}

module.exports = { sanitizeRichText, sanitizePlainText };
