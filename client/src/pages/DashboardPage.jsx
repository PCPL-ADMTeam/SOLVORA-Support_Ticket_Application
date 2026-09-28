import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import { Stack, Box, Typography, Tabs, Tab, TextField, MenuItem, LinearProgress, Fade } from "@mui/material";
import { subDays } from "date-fns";
import { dashboardApi } from "../api/dashboard";
import { departmentsApi } from "../api/departments";
import LoadingState from "../components/common/LoadingState";
import TicketStatsSummary from "../components/dashboard/TicketStatsSummary";
import EmployeeWorkloadTable from "../components/dashboard/EmployeeWorkloadTable";
import DepartmentWorkloadTable from "../components/dashboard/DepartmentWorkloadTable";
import DateRangeFilter from "../components/dashboard/DateRangeFilter";

const SCOPES = ["created", "assigned"];

// Shared dashboard used by all three portals. `variant="full"` (Admin) shows
// every widget, INCLUDING the Department/Employee Workload drill-down below
// (see the All Departments -> Department -> Employees hierarchy in
// AgentDashboardPage.jsx's Manager/Team Lead dashboards, which this mirrors);
// `variant="personal"` (Agent/User) shows a lighter set scoped server-side to
// the caller's own tickets and never gets department awareness at all — see
// dashboard.service.js. The Raised by Me / Assigned to Me tabs re-fetch
// stats scoped to tickets the current user raised (requesterId), or is
// currently assigned to work on (assigneeId) — dashboard.service.js derives
// the id from the authenticated user, never from a client-supplied param,
// and every card/chart below is recomputed from that same scoped query
// (never a combined requester+assignee dataset).
export default function DashboardPage({ variant = "personal", ticketsPath }) {
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState(0);
  const [stats, setStats] = useState(null);
  // See AgentDashboardPage.jsx for the full rationale: `initialLoading`
  // gates the one-time full-page spinner (nothing to show yet); every later
  // refresh (status click, date-range change) uses `refreshing` instead,
  // which keeps the dashboard mounted and only shows a subtle top progress
  // bar — never blanks/remounts the page the way a single shared `loading`
  // flag used to.
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // BI-style Status-pie cross-filter — dashboard-local only, never sent
  // anywhere except back into GET /dashboard/stats's own `status` param
  // (see dashboard.service.js#getStats). Reset whenever the tab/scope
  // changes, since that's a different ticket set entirely.
  const [selectedStatus, setSelectedStatus] = useState(null);
  // Admin-only (variant="full") Department dropdown + BI-style Department/
  // Employee Workload drill-down — mirrors AgentDashboardPage.jsx's Manager
  // dashboard exactly (Department dropdown, selectedEmployee cross-filter),
  // just backed by every department (GET /departments) instead of one
  // Manager's own UserDepartmentAccess set. Both stay harmlessly unused for
  // variant="personal" (Employee/User), which never renders the dropdown or
  // fetches `departments`, so their own dashboard/scope/permissions are
  // completely untouched by any of this.
  const [departments, setDepartments] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(null); // { id, name } | null
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const requestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  // Tracks the last combination of filters that successfully rendered, so a
  // failed request can revert exactly the optimistic change that caused it
  // (same pattern as AgentDashboardPage.jsx's lastGoodFiltersRef) rather than
  // leaving the UI pointing at filters that were never actually fetched.
  const lastGoodFiltersRef = useRef({ selectedStatus: null, selectedDepartment: "", selectedEmployee: null });

  // ADMIN ("full") is the system-wide administrator — "Raised by Me" /
  // "Assigned to Me" is a personal-workspace concept that only makes sense
  // for someone whose dashboard is about their OWN tickets (Agent/User).
  // Previously this tab was forced on for every variant, including Admin,
  // whose dashboard defaulted to scope="created" (tickets the admin
  // account itself raised) instead of the system-wide total — e.g. showing
  // "9" instead of the real 59 rows in `tickets`. Omitting `scope` entirely
  // for Admin lets dashboard.service.js's existing scopeWhereForTab fall
  // through to scopeWhereForUser(user), which is already correctly
  // unrestricted for ADMIN — no backend change was needed for this.
  const showPersonalScopeTabs = variant !== "full";
  const scope = showPersonalScopeTabs ? SCOPES[tab] : undefined;

  useEffect(() => {
    if (variant !== "full") return;
    departmentsApi.list().then(({ data }) => setDepartments(data.data)).catch(() => setDepartments([]));
  }, [variant]);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!hasLoadedOnceRef.current) setInitialLoading(true);
    else setRefreshing(true);
    const attemptedFilters = { selectedStatus, selectedDepartment, selectedEmployee };
    try {
      const dateFrom = subDays(new Date(), days).toISOString();
      const { data } = await dashboardApi.getStats({
        days,
        dateFrom,
        scope,
        status: selectedStatus || undefined,
        departmentId: variant === "full" ? (selectedDepartment || undefined) : undefined,
        assigneeId: variant === "full" ? (selectedEmployee?.id || undefined) : undefined,
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
      if (lastGood.selectedStatus !== selectedStatus) setSelectedStatus(lastGood.selectedStatus);
      if (lastGood.selectedDepartment !== selectedDepartment) setSelectedDepartment(lastGood.selectedDepartment);
      if ((lastGood.selectedEmployee?.id || null) !== (selectedEmployee?.id || null)) setSelectedEmployee(lastGood.selectedEmployee);
    } finally {
      if (requestId === requestIdRef.current) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [days, scope, selectedStatus, selectedDepartment, selectedEmployee, variant, enqueueSnackbar]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Switching Raised-by-Me/Assigned-to-Me is a different ticket set — a
  // status filter selected under one tab shouldn't silently carry over and
  // misrepresent the other. Resetting `selectedStatus` HERE (inside the
  // same event handler that changes `tab`), rather than reactively from a
  // separate effect keyed on `scope`, means both state updates land in one
  // React batch — `load` only ever recreates (and fetches) ONCE per tab
  // click, never once with the stale status and again after it's cleared.
  // `hasLoadedOnceRef` is also reset here — a structurally different KPI
  // set (Raised vs. Assigned), not a plain filter change, so briefly
  // showing the OTHER tab's stale numbers under the new one would be more
  // confusing than one proper full-page loading state (see the render
  // below), same reasoning as AgentDashboardPage.jsx's handleViewChange.
  const handleTabChange = (_event, value) => {
    setSelectedStatus(null);
    hasLoadedOnceRef.current = false;
    setTab(value);
  };

  // Changing the Department dropdown can put the currently-selected employee
  // outside the new scope entirely (an Admin/Manager's employee filter must
  // never silently keep pointing at someone in a department no longer
  // selected) — clear it and recalculate. Status is department-independent,
  // so it's preserved, same precedent as AgentDashboardPage.jsx's own
  // handleDepartmentChange. Reused for BOTH the dropdown's onChange and a
  // Department Workload row click (Section 4 of the drill-down spec: a row
  // click is defined to behave exactly like selecting that department).
  const handleDepartmentChange = (departmentId) => {
    setSelectedEmployee(null);
    setSelectedDepartment(departmentId);
  };

  const clearAllFilters = () => {
    setSelectedStatus(null);
    setSelectedEmployee(null);
    setSelectedDepartment("");
  };

  // `scope` only ever rides along when this dashboard actually has a
  // Raised-by-Me/Assigned-to-Me concept (Agent/User) — Admin's KPIs/charts
  // never carry a scope, so clicking into the ticket list correctly lands
  // on the full, unscoped system-wide list. The currently selected
  // Department/Employee (variant="full" only) ride along too, so drilling
  // into "View Tickets" from a KPI/chart/priority-bar click while scoped to
  // one department (and/or one employee) carries that same scope into the
  // Tickets List rather than silently widening it back out.
  const goToTickets = (params) => {
    const merged = {
      ...(scope ? { scope } : {}),
      ...(variant === "full" && selectedDepartment ? { departmentId: selectedDepartment } : {}),
      ...(variant === "full" && selectedEmployee ? { assigneeId: selectedEmployee.id } : {}),
      ...params,
    };
    navigate(`${ticketsPath}?${new URLSearchParams(merged).toString()}`);
  };

  const selectedDepartmentName = departments.find((d) => d.id === selectedDepartment)?.name;

  return (
    <Stack spacing={3}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
        <Typography variant="h4">{variant === "full" ? "Dashboard" : "My Dashboard"}</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
          {variant === "full" && (
            <TextField
              select
              size="small"
              label="Department"
              value={selectedDepartment}
              onChange={(e) => handleDepartmentChange(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">All Departments</MenuItem>
              {departments.map((d) => (
                <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
              ))}
            </TextField>
          )}
          <DateRangeFilter days={days} onChange={setDays} />
        </Stack>
      </Box>

      {showPersonalScopeTabs && (
        <Tabs value={tab} onChange={handleTabChange} sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tab label="Raised by Me" id="dashboard-raised-by-me-tab" />
          <Tab label="Assigned to Me" id="dashboard-assigned-to-me-tab" />
        </Tabs>
      )}

      {!stats || initialLoading ? (
        <LoadingState minHeight={400} />
      ) : (
        <Fade in appear timeout={200}>
          <Box sx={{ position: "relative", opacity: refreshing ? 0.7 : 1, transition: "opacity 250ms ease" }}>
            {refreshing && (
              <LinearProgress
                sx={{ position: "absolute", top: -8, left: 0, right: 0, height: 3, borderRadius: 1.5, zIndex: 1 }}
              />
            )}
            <DashboardContent
              variant={variant}
              stats={stats}
              goToTickets={goToTickets}
              selectedStatus={selectedStatus}
              onStatusSelect={setSelectedStatus}
              selectedDepartment={selectedDepartment}
              selectedDepartmentName={selectedDepartmentName}
              selectedEmployee={selectedEmployee}
              onSelectDepartment={(d) => handleDepartmentChange(d.departmentId)}
              onSelectEmployee={(w) => setSelectedEmployee((prev) => (prev?.id === w.agentId ? null : { id: w.agentId, name: w.agentName }))}
              onClearEmployee={() => setSelectedEmployee(null)}
              onClearAll={clearAllFilters}
              onBackToAllDepartments={() => handleDepartmentChange("")}
            />
          </Box>
        </Fade>
      )}
    </Stack>
  );
}

function DashboardContent({
  variant, stats, goToTickets, selectedStatus, onStatusSelect,
  selectedDepartment, selectedDepartmentName, selectedEmployee,
  onSelectDepartment, onSelectEmployee, onClearEmployee, onClearAll, onBackToAllDepartments,
}) {
  // Priority is the final drill-down step — navigates to the Tickets List
  // with every currently active filter (status, and for variant="full",
  // the selected department/employee — see goToTickets above).
  const onPriorityDrillDown = (entry) => goToTickets({ ...(selectedStatus ? { status: selectedStatus } : {}), priorityId: entry.id });

  return (
    <>
      <TicketStatsSummary
        stats={stats}
        goToTickets={goToTickets}
        selectedStatus={selectedStatus}
        onStatusSelect={onStatusSelect}
        onPriorityDrillDown={onPriorityDrillDown}
        selectedEmployee={variant === "full" ? selectedEmployee : undefined}
        onClearEmployee={variant === "full" ? onClearEmployee : undefined}
        onClearAll={variant === "full" ? onClearAll : undefined}
      />
      {variant === "full" && (
        selectedDepartment ? (
          <EmployeeWorkloadTable
            workload={stats.workload}
            selectedEmployeeId={selectedEmployee?.id}
            onSelectEmployee={onSelectEmployee}
            title={selectedDepartmentName ? `Employee Workload — ${selectedDepartmentName}` : "Employee Workload"}
            onBack={onBackToAllDepartments}
          />
        ) : (
          <DepartmentWorkloadTable departments={stats.departmentWorkload} onSelectDepartment={onSelectDepartment} />
        )
      )}
    </>
  );
}
