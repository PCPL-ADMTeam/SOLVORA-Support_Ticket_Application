const { Router } = require("express");

const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const teamRoutes = require("./team.routes");
const { priorityRouter } = require("./catalog.routes");
const { departmentRouter, issueRouter } = require("./department.routes");
const ticketRoutes = require("./ticket.routes");
const dashboardRoutes = require("./dashboard.routes");
const notificationRoutes = require("./notification.routes");
const auditLogRoutes = require("./auditLog.routes");
const emailTemplateRoutes = require("./emailTemplate.routes");
const chatbotRoutes = require("../../chatbot/chatbot.routes");

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/teams", teamRoutes);
router.use("/priorities", priorityRouter);
router.use("/departments", departmentRouter);
router.use("/issues", issueRouter);
router.use("/tickets", ticketRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/notifications", notificationRoutes);
router.use("/audit-logs", auditLogRoutes);
router.use("/email-templates", emailTemplateRoutes);
router.use("/chatbot", chatbotRoutes);

module.exports = router;
