const { Router } = require("express");
const authenticate = require("../../middleware/auth");
const dashboardService = require("../../services/dashboard.service");

const router = Router();
router.use(authenticate);

router.get("/stats", async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  // Personal dashboard scopes — "created" = Raised by Me (requesterId = the
  // authenticated user), "assigned" = Assigned to Me (assigneeId = the
  // authenticated user), "mine" = either (raised OR assigned — the Agent
  // "My Dashboard" personal status breakdown/charts, never double-counting
  // a ticket that's both). The user id always comes from req.user (set by
  // the `authenticate` middleware from the verified JWT) — there is no
  // `userId` query param, so a caller can never fetch another user's
  // personal dashboard. Omitting scope falls back to dashboardService's
  // normal role-based ticket visibility (see scopeWhereForUser in
  // ticket.service).
  const scope = ["assigned", "created", "mine"].includes(req.query.scope) ? req.query.scope : undefined;
  // Manager Dashboard's department dropdown — "All Departments" (default)
  // omits this so getStats() aggregates across every department the caller
  // has UserDepartmentAccess to; a specific id narrows to just that one.
  // getStats() itself re-derives the caller's accessible department set
  // server-side and ANDs it in, so a client-supplied id outside that set
  // can only ever narrow results to zero, never expand visibility.
  const departmentId = req.query.departmentId || undefined;
  // BI-style dashboard cross-filtering (Employee Workload row / Status pie
  // slice) — both optional, additive narrowing filters; getStats() itself
  // re-derives the caller's accessible scope server-side and ANDs it in, so
  // neither can ever expand what a request would otherwise be authorized to
  // see (same reasoning as departmentId above).
  const assigneeId = req.query.assigneeId || undefined;
  const status = dashboardService.STATUSES.includes(req.query.status) ? req.query.status : undefined;
  const stats = await dashboardService.getStats(req.user, { dateFrom, dateTo, days, scope, departmentId, assigneeId, status });
  res.json({ success: true, data: stats });
});

module.exports = router;
