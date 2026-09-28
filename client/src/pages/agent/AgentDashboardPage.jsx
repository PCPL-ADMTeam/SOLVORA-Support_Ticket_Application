import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSnackbar } from "notistack";
import { Box, Fade, Stack, Typography, Button, ToggleButtonGroup, ToggleButton, TextField, MenuItem, Chip, LinearProgress } from "@mui/material";
import ListAltIcon from "@mui/icons-material/ListAlt";
import AssignmentLateIcon from "@mui/icons-material/AssignmentLate";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import HourglassBottomIcon from "@mui/icons-material/HourglassBottom";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import ApartmentIcon from "@mui/icons-material/Apartment";
import { subDays } from "date-fns";
import { dashboardApi } from "../../api/dashboard";
import { usersApi } from "../../api/users";
import { useAuth } from "../../context/AuthContext";
import LoadingState from "../../components/common/LoadingState";
import KpiCard from "../../components/dashboard/KpiCard";
import StatusPieChart from "../../components/dashboard/StatusPieChart";
import PriorityBarChart from "../../components/dashboard/PriorityBarChart";
import TrendLineChart from "../../components/dashboard/TrendLineChart";
import DateRangeFilter from "../../components/dashboard/DateRangeFilter";
import EmployeeWorkloadTable from "../../components/dashboard/EmployeeWorkloadTable";
import DepartmentWorkloadTable from "../../components/dashboard/DepartmentWorkloadTable";
import { STATUS_SCALE, DASHBOARD_SECTION_SPACING } from "../../theme/theme";

// Two large, clickable page-level headings standing in for the usual
// single H4 title — literally variant="h4" (same font family/size/weight
// as AgentQueuePage.jsx's "My Tickets" heading; the theme applies its own
// fontWeight:800 to every h4, so both options are always equally bold, no
// active-vs-inactive weight difference), differentiated only by color (dark
// "text.primary" when active, muted "text.secondary" otherwise) and a red
// underline mirroring a Tabs indicator's thickness/position.
function DashboardViewSwitch({ view, onChange }) {
  const OPTIONS = [
    { value: "my", label: "My Dashboard" },
    { value: "department", label: "Department Dashboard" },
  ];
  return (
    <Stack direction="row" spacing={4} flexWrap="wrap" rowGap={1}>
      {OPTIONS.map((opt) => {
        const active = view === opt.value;
        return (
          <Typography
            key={opt.value}
            variant="h4"
            onClick={() => onChange(opt.value)}
            sx={{
              cursor: "pointer",
              userSelect: "none",
              color: active ? "text.primary" : "text.secondary",
              pb: "6px",
              borderBottom: "2px solid",
              borderColor: active ? "primary.main" : "transparent",
              transition: "color 0.15s ease, border-color 0.15s ease",
              "&:hover": active ? undefined : { color: "text.primary" },
            }}
          >
            {opt.label}
          </Typography>
        );
      })}
    </Stack>
  );
}

// ONE page (/agent), ONE `stats` fetch at a time, driven by `?view=` ("my",
// default, or "department") and, within "my", `?scope=` ("created", default
// = Raised by Me, or "assigned" = Assigned to Me). This is NOT two sidebar
// pages and Raised by Me / Assigned to Me are NOT two separate dashboards —
// switching either control only changes this component's own content and
// re-fetches GET /dashboard/stats with the right scope, it never navigates
// away from /agent.
//
// "my" + scope=created/assigned: the ENTIRE stats payload (KPI totals,
// status/priority breakdown, trend, and every chart built from them) comes
// back requesterId- or assigneeId-filtered — dashboardService.getStats
// already threads `scope` through scopeWhereForTab (ticket.service.js) for
// every query it runs, so passing "created"/"assigned" here needed no
// backend change at all, and the user id always comes from the
// authenticated req.user server-side, never a client-supplied value.
//
// "department": no scope passed, so dashboardService's normal role-based
// visibility (scopeWhereForUser) applies — for a MANAGER/TEAMLEAD that's
// exactly "every ticket routed to a department I have access to," real
// backend-enforced scoping, unaffected by who raised a given ticket.
//
// MANAGER vs TEAMLEAD differences (both share this one component, per the
// final role rules — never two separate dashboard pages):
//  - TEAMLEAD keeps the original behavior exactly: defaults to "My
//    Dashboard," and "My Dashboard" itself offers both Raised by Me and
//    Assigned to Me (a Team Lead can be a ticket's assignee). "Department
//    Dashboard" is always their own single accessible department — no
//    department dropdown is ever shown, since there's nothing to choose
//    between.
//  - MANAGER instead defaults to "Department Dashboard" showing ALL their
//    accessible departments, offers a department dropdown there (they may
//    have several), and their "My Dashboard" has no Raised/Assigned toggle
//    at all — only Raised by Me, since a Manager is never a ticket assignee
//    and therefore has no "Assigned to Me" data to switch to.
export default function AgentDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isManager = user.role.name === "MANAGER";
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.has("view")
    ? (searchParams.get("view") === "department" ? "department" : "my")
    : (isManager ? "department" : "my");
  // A Manager has no "Assigned to Me" data (never a ticket assignee), so
  // their My Dashboard is always Raised by Me regardless of any stale
  // ?scope= left in the URL.
  const myScope = !isManager && searchParams.get("scope") === "assigned" ? "assigned" : "created";
  // "" = All Departments (the default) — every department this MANAGER has
  // UserDepartmentAccess to, aggregated. A specific id narrows the whole
  // Department Dashboard (KPIs, charts, workload table) to just that one.
  // Never applicable to a TEAMLEAD, who has exactly one department and no
  // dropdown to select from.
  const departmentId = view === "department" && isManager ? searchParams.get("departmentId") || "" : "";

  const [days, setDays] = useState(30);
  const [stats, setStats] = useState(null);
  // `initialLoading` gates the one-time full-page LoadingState (first paint
  // only — there is nothing to keep visible yet). `refreshing` covers every
  // later fetch (filter click, date-range change, department switch): the
  // dashboard stays fully mounted with its LAST GOOD `stats` on screen, and
  // this only drives a subtle top progress bar (see the render below) — it
  // must never blank/replace the page, which was the root cause of the
  // reload-flash this fixes (the old code used one `loading` flag for both
  // cases, unmounting the entire dashboard on every single filter click).
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myDepartments, setMyDepartments] = useState([]);
  const { enqueueSnackbar } = useSnackbar();

  // BI-style dashboard cross-filtering — dashboard-local only, sent to
  // GET /dashboard/stats as `status`/`assigneeId` (see
  // dashboard.service.js#getStats) so the Priority chart (and, for
  // "department", the Status chart/KPIs too) recalculate server-side.
  // `selectedEmployee` is only ever set from a real Employee Workload row
  // ({ id: agentId, name: agentName } — see EmployeeWorkloadTable.jsx), so
  // it's always a real, already-in-scope user id. "my" has no Employee
  // Workload table at all, so it only ever uses `selectedMyStatus`.
  const [selectedMyStatus, setSelectedMyStatus] = useState(null);
  const [selectedDeptStatus, setSelectedDeptStatus] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null); // { id, name } | null

  // Plain refs (never trigger a re-render themselves) used only to: (a)
  // ignore a stale response if a second click fires before the first
  // request returns (never overwrite fresher state with an older answer),
  // and (b) remember the last combination of filters that successfully
  // rendered, so a failed request can revert the optimistic filter change
  // that caused it rather than leaving the UI pointing at data that was
  // never actually fetched.
  const requestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  const lastGoodFiltersRef = useRef({ selectedMyStatus: null, selectedDeptStatus: null, selectedEmployee: null });

  useEffect(() => {
    usersApi.myDepartmentAccess().then(({ data }) => setMyDepartments(data.data)).catch(() => setMyDepartments([]));
  }, []);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!hasLoadedOnceRef.current) setInitialLoading(true);
    else setRefreshing(true);

    const attemptedFilters = { selectedMyStatus, selectedDeptStatus, selectedEmployee };
    try {
      const dateFrom = subDays(new Date(), days).toISOString();
      const scope = view === "my" ? myScope : undefined;
      const status = view === "my" ? selectedMyStatus : selectedDeptStatus;
      const { data } = await dashboardApi.getStats({
        days,
        dateFrom,
        scope,
        departmentId: departmentId || undefined,
        status: status || undefined,
        assigneeId: view === "department" ? selectedEmployee?.id || undefined : undefined,
      });
      if (requestId !== requestIdRef.current) return; // a newer request already won
      setStats(data.data);
      hasLoadedOnceRef.current = true;
      lastGoodFiltersRef.current = attemptedFilters;
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      enqueueSnackbar(err.response?.data?.message || "Failed to update the dashboard", { variant: "error" });
      // Restore whichever filter(s) actually caused this failed request —
      // `stats` itself is left completely untouched, so the dashboard stays
      // exactly as it looked before the click, never a broken partial state.
      const lastGood = lastGoodFiltersRef.current;
      if (lastGood.selectedMyStatus !== selectedMyStatus) setSelectedMyStatus(lastGood.selectedMyStatus);
      if (lastGood.selectedDeptStatus !== selectedDeptStatus) setSelectedDeptStatus(lastGood.selectedDeptStatus);
      if ((lastGood.selectedEmployee?.id || null) !== (selectedEmployee?.id || null)) setSelectedEmployee(lastGood.selectedEmployee);
    } finally {
      if (requestId === requestIdRef.current) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [days, view, myScope, departmentId, selectedMyStatus, selectedDeptStatus, selectedEmployee, enqueueSnackbar]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const handleViewChange = (value) => {
    // Switching between "My Dashboard" and "Department Dashboard" is a
    // different ticket set for each — never carry a filter meant for one
    // into the other.
    setSelectedMyStatus(null);
    setSelectedDeptStatus(null);
    setSelectedEmployee(null);
    // Unlike a filter click, this genuinely swaps to a different section
    // with differently-shaped KPIs (My Dashboard's Raised/Assigned vs.
    // Department's Total/Unassigned) — briefly showing the OTHER section's
    // stale numbers under the new layout would be more confusing than a
    // proper one-time loading state, so this is the one interaction that
    // still gets the full LoadingState treatment (key={view} below already
    // remounts the Fade for it).
    hasLoadedOnceRef.current = false;
    setSearchParams({ view: value });
  };
  const handleMyScopeChange = (_event, value) => {
    if (!value) return; // ToggleButtonGroup fires with null when the active button is clicked again
    setSelectedMyStatus(null);
    setSearchParams({ view: "my", scope: value });
  };
  // Reused for both the Department dropdown's onChange AND a Department
  // Workload row click (see the render below) — clicking a row is defined
  // to behave exactly like selecting that department from the dropdown.
  const handleDepartmentChange = (value) => {
    const next = { view: "department" };
    if (value) next.departmentId = value;
    // Changing which department is selected can put the currently-selected
    // employee outside the new scope entirely (a Manager's employee filter
    // must never silently keep pointing at someone in a department they no
    // longer have narrowed the view to) — clear it and recalculate. Status
    // is department-independent, so it's preserved.
    setSelectedEmployee(null);
    setSearchParams(next);
  };

  // Drills into the SAME /agent/queue page's own My Tickets sub-filter (see
  // AgentQueuePage.jsx) — never a separate route — always using the My
  // Dashboard's CURRENTLY active mode (myScope), so an "Open" KPI clicked
  // while viewing Assigned to Me opens the queue scoped to assigned+OPEN,
  // never silently falling back to Raised by Me.
  const goToMyFilteredTickets = (params) => navigate(`/agent/queue?${new URLSearchParams({ view: "my", scope: myScope, ...params }).toString()}`);
  const goToDepartmentTickets = (params) => navigate(`/agent/queue?${new URLSearchParams({ view: "department", ...(departmentId ? { departmentId } : {}), ...params }).toString()}`);

  // Priority is the final drill-down step of the dashboard's BI-style
  // cross-filtering — navigates to the existing Tickets List carrying EVERY
  // currently active filter (status, and for "department", the selected
  // employee's real assigneeId), never just the clicked priority alone.
  // Reuses the Tickets List's own existing `assigneeId`/`status`/
  // `priorityId` query params — no new list implementation.
  const priorityDrillDownMy = (entry) => goToMyFilteredTickets({ ...(selectedMyStatus ? { status: selectedMyStatus } : {}), priorityId: entry.id });
  const priorityDrillDownDept = (entry) =>
    goToDepartmentTickets({
      ...(selectedEmployee ? { assigneeId: selectedEmployee.id } : {}),
      ...(selectedDeptStatus ? { status: selectedDeptStatus } : {}),
      priorityId: entry.id,
    });

  const clearDeptFilters = () => {
    setSelectedEmployee(null);
    setSelectedDeptStatus(null);
    // A Manager's "Clear All Filters" also returns the Department dropdown
    // to "All Departments" (their own full accessible scope) — a Team Lead
    // has no dropdown to reset (isManager is false, departmentId is always
    // "" already), so this is a no-op for them, never touching their
    // existing single-department scope.
    if (isManager && departmentId) setSearchParams({ view: "department" });
  };

  const kpis = stats?.kpis;
  const byStatus = stats?.byStatus;
  const byPriority = stats?.byPriority;
  const trend = stats?.trend;
  const workload = stats?.workload;

  return (
    <Stack spacing={3}>
      {/* Header stays mounted across both loading and view-switch — this is
          what keeps the layout stable instead of flashing a full-page
          spinner (and losing scroll position) every time the switch or the
          date range is touched. DashboardViewSwitch is the page's only
          top-of-page heading (there is deliberately no separate large
          "Dashboard" title above it). */}
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "flex-end" }} spacing={1.5} flexWrap="wrap">
        <Box>
          <DashboardViewSwitch view={view} onChange={handleViewChange} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {view === "my"
              ? "Your personal tickets and assignments"
              : (() => {
                  if (!myDepartments.length) return "No department access assigned — contact an administrator";
                  // A Team Lead has exactly one accessible department — show
                  // it directly, never an "All Departments" framing that
                  // implies a choice they don't have.
                  if (!isManager) return myDepartments[0].name;
                  if (!departmentId) return `All Departments (${myDepartments.length})`;
                  return myDepartments.find((d) => d.id === departmentId)?.name || "All Departments";
                })()}
          </Typography>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "flex-end" }}>
          {view === "department" && isManager && (
            <TextField
              select
              size="small"
              label="Department"
              value={departmentId}
              onChange={(e) => handleDepartmentChange(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">All Departments</MenuItem>
              {myDepartments.map((d) => (
                <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
              ))}
            </TextField>
          )}
          <DateRangeFilter days={days} onChange={setDays} />
        </Stack>
      </Stack>

      {!stats || initialLoading ? (
        <LoadingState minHeight={300} />
      ) : (
        // key={view} forces a clean remount ONLY on an actual My/Department
        // view switch (a genuinely different section) so the fade-in still
        // plays there; a filter click, date-range change, or department-
        // dropdown change never touches `view`, so none of those remount
        // this at all — the dashboard (KPIs, charts, Employee Workload)
        // stays mounted throughout, and `refreshing` below drives a subtle
        // top progress bar instead of ever hiding it.
        <Fade in appear timeout={200} key={view}>
          <Box sx={{ position: "relative", opacity: refreshing ? 0.7 : 1, transition: "opacity 250ms ease" }}>
            {refreshing && (
              <LinearProgress
                sx={{ position: "absolute", top: -8, left: 0, right: 0, height: 3, borderRadius: 1.5, zIndex: 1 }}
              />
            )}
            {view === "my" ? (
              <Stack spacing={DASHBOARD_SECTION_SPACING}>
                {/* Same ToggleButtonGroup component/sx as AgentQueuePage.jsx's
                    "Raised by Me"/"Assigned to Me" control. Unlike a plain
                    nav shortcut, this one IS the My Dashboard's own data
                    mode: selecting it re-fetches stats with scope=created or
                    scope=assigned (see `load` above) rather than navigating
                    away — one dashboard, two datasets, same layout. A
                    Manager has no "Assigned to Me" data (never a ticket
                    assignee — see the final role rules), so this toggle is
                    hidden entirely for that role and My Dashboard is simply
                    always Raised by Me. */}
                {!isManager && (
                  <ToggleButtonGroup exclusive size="small" value={myScope} onChange={handleMyScopeChange}>
                    <ToggleButton value="created" sx={{ minWidth: 140, justifyContent: "center" }}>Raised by Me</ToggleButton>
                    <ToggleButton value="assigned" sx={{ minWidth: 140, justifyContent: "center" }}>Assigned to Me</ToggleButton>
                  </ToggleButtonGroup>
                )}

                {/* Personal KPIs — one flex row (not the 12-column Grid,
                    since 6 doesn't divide evenly into 12) keeps all 6 cards
                    on one line on desktop. Every value here (and every chart
                    below) comes from the SAME scope=myScope stats payload,
                    so all of it — KPIs, pie/bar charts, trend — already
                    reflects whichever mode (Raised by Me / Assigned to Me)
                    is currently selected with no separate per-card scope
                    logic needed. */}
                <Box sx={{ display: "flex", flexWrap: { xs: "wrap", md: "nowrap" }, gap: 2 }}>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="Total Tickets" value={kpis.total} color="#6b1f25" icon={<ListAltIcon />} onClick={() => goToMyFilteredTickets({})} />
                  </Box>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="Open" value={kpis.open} color="#c81e2a" icon={<PendingActionsIcon />} onClick={() => goToMyFilteredTickets({ status: "OPEN" })} />
                  </Box>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="In Progress" value={kpis.in_progress} color="#eb6834" icon={<HourglassBottomIcon />} onClick={() => goToMyFilteredTickets({ status: "IN_PROGRESS" })} />
                  </Box>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="On Hold" value={kpis.on_hold} color="#eda100" icon={<PauseCircleOutlineIcon />} onClick={() => goToMyFilteredTickets({ status: "ON_HOLD" })} />
                  </Box>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="Resolved" value={kpis.resolved} color="#0ca30c" icon={<TaskAltIcon />} onClick={() => goToMyFilteredTickets({ status: "RESOLVED" })} />
                  </Box>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="Closed" value={kpis.closed} color="#898781" onClick={() => goToMyFilteredTickets({ status: "CLOSED" })} />
                  </Box>
                </Box>

                {selectedMyStatus && (
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="body2" fontWeight={600} color="text.secondary">Active Filters:</Typography>
                    <Chip
                      label={`Status: ${selectedMyStatus.replace("_", " ")}`}
                      size="small"
                      color="primary"
                      variant="outlined"
                      onDelete={() => setSelectedMyStatus(null)}
                    />
                    <Button size="small" onClick={() => setSelectedMyStatus(null)}>Clear All Filters</Button>
                  </Stack>
                )}

                <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <StatusPieChart
                      data={byStatus}
                      selectedStatus={selectedMyStatus}
                      onSliceClick={(status) => setSelectedMyStatus((prev) => (prev === status ? null : status))}
                    />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <PriorityBarChart data={byPriority} onBarClick={priorityDrillDownMy} />
                  </Box>
                </Box>

                <TrendLineChart data={trend} />
              </Stack>
            ) : (
              <Stack spacing={DASHBOARD_SECTION_SPACING}>
                {/* Department KPIs — same flex-row treatment as above. */}
                <Box sx={{ display: "flex", flexWrap: { xs: "wrap", md: "nowrap" }, gap: 2 }}>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="Total Department Tickets" value={kpis.totalDepartmentTickets} color="#6b1f25" icon={<ApartmentIcon />} onClick={() => goToDepartmentTickets({})} />
                  </Box>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="Unassigned" value={kpis.unassigned} color={STATUS_SCALE.warning} icon={<AssignmentLateIcon />} onClick={() => goToDepartmentTickets({ assigned: "false" })} />
                  </Box>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="Open" value={kpis.open} color="#c81e2a" icon={<PendingActionsIcon />} onClick={() => goToDepartmentTickets({ status: "OPEN" })} />
                  </Box>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="In Progress" value={kpis.in_progress} color="#eb6834" icon={<HourglassBottomIcon />} onClick={() => goToDepartmentTickets({ status: "IN_PROGRESS" })} />
                  </Box>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="On Hold" value={kpis.on_hold} color="#eda100" icon={<PauseCircleOutlineIcon />} onClick={() => goToDepartmentTickets({ status: "ON_HOLD" })} />
                  </Box>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="Resolved" value={kpis.resolved} color="#0ca30c" icon={<TaskAltIcon />} onClick={() => goToDepartmentTickets({ status: "RESOLVED" })} />
                  </Box>
                  <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
                    <KpiCard label="Closed" value={kpis.closed} color="#898781" onClick={() => goToDepartmentTickets({ status: "CLOSED" })} />
                  </Box>
                </Box>

                {/* BI-style cross-filter bar — Employee (from Employee
                    Workload below) and Status (from the pie chart) combine
                    cumulatively, never replace each other; clearing one
                    preserves the other exactly as specified. */}
                {(selectedEmployee || selectedDeptStatus) && (
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="body2" fontWeight={600} color="text.secondary">Active Filters:</Typography>
                    {selectedEmployee && (
                      <Chip
                        label={`Employee: ${selectedEmployee.name}`}
                        size="small"
                        color="primary"
                        variant="outlined"
                        onDelete={() => setSelectedEmployee(null)}
                      />
                    )}
                    {selectedDeptStatus && (
                      <Chip
                        label={`Status: ${selectedDeptStatus.replace("_", " ")}`}
                        size="small"
                        color="primary"
                        variant="outlined"
                        onDelete={() => setSelectedDeptStatus(null)}
                      />
                    )}
                    <Button size="small" onClick={clearDeptFilters}>Clear All Filters</Button>
                  </Stack>
                )}

                <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <StatusPieChart
                      data={byStatus}
                      selectedStatus={selectedDeptStatus}
                      onSliceClick={(status) => setSelectedDeptStatus((prev) => (prev === status ? null : status))}
                    />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <PriorityBarChart data={byPriority} onBarClick={priorityDrillDownDept} />
                  </Box>
                </Box>

                {/* Manager "All Departments" (no departmentId selected) shows
                    the department-level rollup; selecting one (via the
                    dropdown above OR clicking a row here) drills into that
                    department's own Employee Workload — the same table Team
                    Lead always sees directly, since they have no "all
                    departments" level to start from (isManager is false, so
                    this condition never applies to them). */}
                {isManager && !departmentId ? (
                  <DepartmentWorkloadTable
                    departments={stats?.departmentWorkload || []}
                    onSelectDepartment={(d) => handleDepartmentChange(d.departmentId)}
                  />
                ) : (
                  <EmployeeWorkloadTable
                    workload={workload}
                    selectedEmployeeId={selectedEmployee?.id}
                    onSelectEmployee={(w) => setSelectedEmployee((prev) => (prev?.id === w.agentId ? null : { id: w.agentId, name: w.agentName }))}
                    title={isManager && departmentId ? `Employee Workload — ${myDepartments.find((d) => d.id === departmentId)?.name || ""}` : "Employee Workload"}
                    onBack={isManager && departmentId ? () => handleDepartmentChange("") : undefined}
                  />
                )}

                <Box>
                  <Button variant="outlined" startIcon={<ListAltIcon />} onClick={() => goToDepartmentTickets({})}>
                    View Department Tickets
                  </Button>
                </Box>
              </Stack>
            )}
          </Box>
        </Fade>
      )}
    </Stack>
  );
}
