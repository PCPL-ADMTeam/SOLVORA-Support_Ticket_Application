import api from "./axios";

export const notificationsApi = {
  list: (params) => api.get("/notifications", { params }),
  markRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch("/notifications/read-all"),
  clearAll: () => api.delete("/notifications"),
};
