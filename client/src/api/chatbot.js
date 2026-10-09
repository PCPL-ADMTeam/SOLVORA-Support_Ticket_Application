import api from "./axios";

// The browser's own time zone (an IANA name such as "Asia/Kolkata"), so "today" means the user's day.
// It only chooses where a day starts; the server validates it and falls back to UTC.
const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

// Thin wrapper over the server's chatbot endpoints. Note what is never sent:
// a role, a user id or a portal — the server derives all of that from the
// authenticated session.
export const chatbotApi = {
  suggestions: () => api.get("/chatbot/suggestions"),
  // `pageTicketId` is the id in the open ticket page's URL. It is only a hint for "this ticket":
  // the server turns it into a ticket number only if this user may view that ticket.
  sendMessage: (message, conversationId, pageTicketId) => {
    const timeZone = browserTimeZone();
    return api.post("/chatbot/messages", { message, ...(conversationId ? { conversationId } : {}), ...(pageTicketId ? { pageTicketId } : {}), ...(timeZone ? { timeZone } : {}) });
  },
  getConversation: (conversationId) => api.get(`/chatbot/conversations/${conversationId}`),
  // One page of the signed-in user's own conversations (the server decides whose they are).
  listConversations: (params) => api.get("/chatbot/conversations", params ? { params } : undefined),
  resumeConversation: (conversationId) => api.post(`/chatbot/conversations/${conversationId}/resume`),
  deleteConversation: (conversationId) => api.delete(`/chatbot/conversations/${conversationId}`),
  // Several of MY conversations, by id; ids that are not mine are ignored by the server.
  deleteConversations: (conversationIds) => api.post("/chatbot/conversations/bulk-delete", { conversationIds }),
  // Every conversation I have. `confirm` must be true or the server refuses.
  deleteAllConversations: () => api.post("/chatbot/conversations/delete-all", { confirm: true }),
  resetConversation: (conversationId) => api.post(`/chatbot/conversations/${conversationId}/reset`),
  // Admin changes proposed in chat run ONLY through these two calls.
  // The one-time token shown with the preview and the conversation id must accompany both calls.
  confirmAction: (actionId, confirmationToken, conversationId) => api.post(`/chatbot/actions/${actionId}/confirm`, { confirmationToken, conversationId }),
  cancelAction: (actionId, confirmationToken, conversationId) => api.post(`/chatbot/actions/${actionId}/cancel`, { confirmationToken, conversationId }),
  // Files for the ticket being raised through the assistant (same limits as the Raise a Ticket page).
  uploadDraftFiles: (formData) => api.post("/chatbot/drafts/attachments", formData, { headers: { "Content-Type": "multipart/form-data" } }),
  // `quiet`: change the open form in place (no chat message). Not used at the review.
  removeDraftFile: (attachmentId, conversationId, quiet = false) => api.delete(`/chatbot/drafts/attachments/${attachmentId}`, { params: { conversationId, ...(quiet ? { quiet: "1" } : {}) } }),
  // The form's "Review Ticket": every field at once. Never carries a role, user or source department.
  reviewDraft: (payload) => api.post("/chatbot/drafts/review", payload),
  // People to CC, searched among real active users while a ticket is being raised.
  searchDraftCc: (conversationId, q) => api.get("/chatbot/drafts/cc-search", { params: { conversationId, q } }),
  // One attached file of the ticket being raised, as bytes, to open in a new tab.
  fetchDraftFile: (attachmentId, conversationId) => api.get(`/chatbot/drafts/attachments/${attachmentId}`, { params: { conversationId }, responseType: "blob" }),
  sendFeedback: (messageId, rating, reason) =>
    api.post(`/chatbot/messages/${messageId}/feedback`, reason ? { rating, reason } : { rating }),
};
