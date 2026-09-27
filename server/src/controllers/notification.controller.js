const notificationService = require("../services/notification.service");

async function list(req, res) {
  const data = await notificationService.listForUser(req.user.id, { unreadOnly: req.query.unreadOnly === "true" });
  res.json({ success: true, data });
}

async function markRead(req, res) {
  await notificationService.markRead(req.user.id, req.params.id);
  res.json({ success: true });
}

async function markAllRead(req, res) {
  await notificationService.markAllRead(req.user.id);
  res.json({ success: true });
}

async function clearAll(req, res) {
  await notificationService.clearAll(req.user.id);
  res.json({ success: true });
}

module.exports = { list, markRead, markAllRead, clearAll };
