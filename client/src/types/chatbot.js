/**
 * Shared JSDoc typedefs for the chatbot UI (the client is plain JavaScript).
 *
 * @typedef {{ type: "route", path: string, label: string } | { type: "dialog", dialog: "profile" | "edit-profile", label: string }} NavigationTarget
 *
 * @typedef {{ label: string, prompt: string }} SuggestedAction
 *
 * @typedef {{ code: string, message: string, retryable?: boolean }} ChatErrorInfo
 *
 * @typedef {Object} ChatUiMessage
 * @property {string} key             Stable React key.
 * @property {"user" | "assistant"} role
 * @property {string} text
 * @property {string} [messageId]     Server message id (assistant only) — used for feedback.
 * @property {string} [intent]
 * @property {Object} [data]          Restricted DTOs: tickets, summary, summaries, history, statistics, article...
 * @property {NavigationTarget | null} [navigationTarget]
 * @property {SuggestedAction[]} [suggestedActions]
 * @property {ChatErrorInfo | null} [error]
 *
 * @typedef {Object} ChatSuggestions
 * @property {string} portal
 * @property {string} role
 * @property {string} welcomeMessage
 * @property {string[]} suggestions
 */
export {};
