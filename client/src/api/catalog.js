import api from "./axios";

export const prioritiesApi = {
  list: () => api.get("/priorities"),
  create: (payload) => api.post("/priorities", payload),
  update: (id, payload) => api.patch(`/priorities/${id}`, payload),
};
