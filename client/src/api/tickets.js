import api from "./axios";

export const ticketsApi = {
  list: (params) => api.get("/tickets", { params }),
  getById: (id) => api.get(`/tickets/${id}`),
  create: (payload) =>
    api.post("/tickets", payload, payload instanceof FormData ? { headers: { "Content-Type": "multipart/form-data" } } : undefined),
  update: (id, payload) => api.patch(`/tickets/${id}`, payload),
  transferDepartment: (id, payload) => api.patch(`/tickets/${id}/transfer-department`, payload),
  // With no files, this is a plain JSON POST exactly as before. With one or
  // more files, it becomes a single multipart request (the comment and its
  // attachments created together server-side — see
  // ticket.service.js#addComment) rather than the old separate
  // create-then-uploadAttachment round trip, so an attachment-only comment
  // never has to exist text-less-and-fileless in between the two calls.
  addComment: (id, payload, files = []) => {
    if (!files.length) return api.post(`/tickets/${id}/comments`, payload);
    const formData = new FormData();
    formData.append("body", payload.body || "");
    if (payload.isInternal) formData.append("isInternal", "true");
    files.forEach((file) => formData.append("attachments", file));
    return api.post(`/tickets/${id}/comments`, formData, { headers: { "Content-Type": "multipart/form-data" } });
  },
  bulkUpdate: (payload) => api.post("/tickets/bulk", payload),
  uploadAttachment: (id, file, commentId) => {
    const formData = new FormData();
    formData.append("file", file);
    if (commentId) formData.append("commentId", commentId);
    return api.post(`/tickets/${id}/attachments`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  // Backend-streamed (see ticket.service.js#streamAttachment) — the
  // endpoint requires the same Bearer auth as every other API call, which
  // a plain <img src>/<a href> can't attach, so callers fetch the bytes as
  // a Blob via this (through the same authenticated axios instance) and
  // build an object URL from the response instead.
  downloadAttachment: (ticketId, attachmentId) =>
    api.get(`/tickets/${ticketId}/attachments/${attachmentId}/download`, { responseType: "blob" }),
  deleteAttachment: (ticketId, attachmentId) => api.delete(`/tickets/${ticketId}/attachments/${attachmentId}`),
  // Author-only (enforced server-side). expectedUpdatedAt guards against
  // overwriting a newer edit (409).
  updateComment: (ticketId, commentId, payload) => api.patch(`/tickets/${ticketId}/comments/${commentId}`, payload),
  deleteComment: (ticketId, commentId) => api.delete(`/tickets/${ticketId}/comments/${commentId}`),
};
