const prisma = require("../../config/prisma");
const dashboardService = require("../../services/dashboard.service");
const { authorizedWhere } = require("../roleScope");
const notificationService = require("../../services/notification.service");
const { ChatError, CODES } = require("../chatbot.errors");

// Tools over the signed-in user's OWN data. They reuse the application's existing
// services (the same ones the dashboard and the notification bell call), and the
// user is always the authenticated one: there is no userId input, so nothing in a
// message can point these at someone else.

const SCOPES = ["created", "assigned", "mine"];
// A calendar date, or an exact instant (a day that starts at the user's own midnight).
const DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const getMyDashboard = {
  name: "get_my_dashboard",
  description: "The caller's dashboard numbers (status and priority counts) for tickets raised by them, assigned to them, or either, over a date range.",
  inputSchema: {
    scope: { type: "enum", values: SCOPES },
    days: { type: "int", min: 1, max: 365 },
    dateFrom: { type: "string", max: 30, pattern: DATE },
    dateTo: { type: "string", max: 30, pattern: DATE },
  },
  async run(ctx, input) {
    // Same service and same arguments the dashboard page uses (scope "created" = Raised by Me). The page
    // sends "Last N days" as dateFrom = now - N days; the service's `days` alone only shapes the trend
    // chart, so without that dateFrom the counts would cover all time while being labelled "last N days".
    const days = input.days || 30;
    const stats = await dashboardService.getStats(ctx.scope.user, {
      scope: input.scope || "mine",
      days,
      dateFrom: input.dateFrom || (input.dateTo ? undefined : new Date(Date.now() - days * DAY_MS).toISOString()),
      dateTo: input.dateTo,
    });
    await ctx.audit("TOOL_MY_DASHBOARD", "Dashboard", input.scope || "mine", "SUCCESS");
    return {
      total: stats.kpis.total,
      byStatus: stats.byStatus.map((s) => ({ status: s.status, count: s.count })),
      byPriority: stats.byPriority.map((p) => ({ priority: p.priority, count: p.count })),
    };
  },
};

const getMyNotifications = {
  name: "get_my_notifications",
  description: "The caller's own in-app notifications (newest first, at most 50) and their unread count.",
  inputSchema: { unreadOnly: { type: "enum", values: ["yes"] } },
  async run(ctx, input) {
    const userId = ctx.scope.userId;
    const [rows, unread] = await Promise.all([notificationService.listForUser(userId, { unreadOnly: input.unreadOnly === "yes" }), notificationService.countUnread(userId)]);
    // A notification can outlive the user's access to its ticket (e.g. the ticket moved to another
    // department). Its ticket link is only offered when the ticket is still inside this user's scope.
    const ticketIds = [...new Set(rows.map((n) => n.ticket?.id).filter(Boolean))];
    const viewable = ticketIds.length
      ? new Set((await prisma.ticket.findMany({ where: { AND: [{ id: { in: ticketIds } }, authorizedWhere(ctx.scope)] }, select: { id: true } })).map((t) => t.id))
      : new Set();
    await ctx.audit("TOOL_MY_NOTIFICATIONS", "Notification", null, "SUCCESS");
    return {
      unread,
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        isRead: n.isRead,
        createdAt: n.createdAt,
        ticketNumber: n.ticket?.ticketNumber || null,
        ticketRouteId: n.ticket?.id && viewable.has(n.ticket.id) ? n.ticket.id : null,
      })),
    };
  },
};

// The same numbers the dashboard pages show (status, priority, created-vs-resolved trend, workload),
// through the same service, so the department / all-department scope and the access check on a
// chosen department are the application's own. An Employee only ever gets their own tickets.
const getDashboardOverview = {
  name: "get_dashboard_overview",
  description: "Status and priority breakdown, created-vs-resolved trend and workload for the caller's own authorized scope (the dashboard service).",
  inputSchema: {
    days: { type: "int", min: 1, max: 90 },
    departmentId: { type: "string", max: 64, pattern: /^[A-Za-z0-9_-]{1,64}$/ },
  },
  async run(ctx, input) {
    const personal = ctx.scope.role === "EMPLOYEE";
    let stats;
    try {
      stats = await dashboardService.getStats(ctx.scope.user, { scope: personal ? "mine" : undefined, days: input.days || 30, departmentId: personal ? undefined : input.departmentId });
    } catch (err) {
      if (err?.statusCode === 403) throw new ChatError(CODES.ACCESS_DENIED, { internal: "dashboard department outside access" });
      throw err;
    }
    await ctx.audit("TOOL_DASHBOARD_OVERVIEW", "Dashboard", input.departmentId || "scope", "SUCCESS");
    return { total: stats.kpis.total, byStatus: stats.byStatus, byPriority: stats.byPriority, trend: stats.trend, workload: stats.workload, departmentWorkload: stats.departmentWorkload };
  },
};

module.exports = { tools: [getMyDashboard, getMyNotifications, getDashboardOverview] };
