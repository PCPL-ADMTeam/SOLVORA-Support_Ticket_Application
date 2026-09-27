const { Router } = require("express");
const notificationController = require("../../controllers/notification.controller");
const authenticate = require("../../middleware/auth");

const router = Router();
router.use(authenticate);

router.get("/", notificationController.list);
router.patch("/:id/read", notificationController.markRead);
router.patch("/read-all", notificationController.markAllRead);
// Permanently deletes only the authenticated caller's own Notification rows
// (req.user.id, from the verified JWT — never a client-supplied userId).
router.delete("/", notificationController.clearAll);

module.exports = router;
