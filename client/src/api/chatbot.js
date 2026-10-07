import api from "./axios";

// Thin wrapper over the server's chatbot endpoints. Note what is never sent:
// a role, a user id or a portal — the server derives all of that from the
// authenticated session.
export const chatbotApi = {
  suggestions: () => api.get("/chatbot/suggestions"),
  // `pageTicketId` is the id in the open ticket page's URL. It is only a hint for "this ticket":
  // the server turns it into a ticket number only if this user may view that ticket.
  sendMessage: (message, conversationId, pageTicketId) =>
    api.post("/chatbot/messages", { message, ...(conversationId ? { conversationId } : {}), ...(pageTicketId ? { pageTicketId } : {}) }),
  getConversation: (conversationId) => api.get(`/chatbot/conversations/${conversationId}`),
  listConversations: () => api.get("/chatbot/conversations"),
  resumeConversation: (conversationId) => api.post(`/chatbot/conversations/${conversationId}/resume`),
  deleteConversation: (conversationId) => api.delete(`/chatbot/conversations/${conversationId}`),
  resetConversation: (conversationId) => api.post(`/chatbot/conversations/${conversationId}/reset`),
  // Admin changes proposed in chat run ONLY through these two calls.
  // The one-time token shown with the preview and the conversation id must accompany both calls.
  confirmAction: (actionId, confirmationToken, conversationId) => api.post(`/chatbot/actions/${actionId}/confirm`, { confirmationToken, conversationId }),
  cancelAction: (actionId, confirmationToken, conversationId) => api.post(`/chatbot/actions/${actionId}/cancel`, { confirmationToken, conversationId }),
  // Files for the ticket being raised through the assistant (same limits as the Raise a Ticket page).
  uploadDraftFiles: (formData) => api.post("/chatbot/drafts/attachments", formData, { headers: { "Content-Type": "multipart/form-data" } }),
  removeDraftFile: (attachmentId, conversationId) => api.delete(`/chatbot/drafts/attachments/${attachmentId}`, { params: { conversationId } }),
  sendFeedback: (messageId, rating, reason) =>
    api.post(`/chatbot/messages/${messageId}/feedback`, reason ? { rating, reason } : { rating }),
};
