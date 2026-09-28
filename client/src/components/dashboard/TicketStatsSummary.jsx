import { Box, Stack, Typography, Chip, Button } from "@mui/material";
import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import HourglassBottomIcon from "@mui/icons-material/HourglassBottom";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import KpiCard from "./KpiCard";
import StatusPieChart from "./StatusPieChart";
import PriorityBarChart from "./PriorityBarChart";
import TrendLineChart from "./TrendLineChart";
import { DASHBOARD_SECTION_SPACING } from "../../theme/theme";

// The standard "Total / Open / In Progress / On Hold / Resolved / Closed"
// KPI row + Status/Priority charts + created-vs-resolved trend chart.
// Shared by DashboardPage.jsx (Admin's full view and every USER personal
// tab) and AgentDashboardPage.jsx (the Agent's own Raised-by-Me/Assigned-
// to-Me tabs) so all of these views render from exactly one implementation
// — never a visually-similar duplicate — whatever `stats` they're handed
// (already scoped server-side by the caller, e.g. a `scope=created` stats
// response for a "Raised by Me" tab).
//
// BI-style cross-filtering: clicking a Status pie slice no longer navigates
// away — it sets `selectedStatus` on the caller (via `onStatusSelect`),
// which re-fetches `stats` with that status applied server-side (see
// dashboard.service.js#getStats's `status` param) so the Priority chart
// below recalculates for just that status. The Priority chart remains the
// final drill-down: clicking a bar navigates to the Tickets List with
// EVERY currently active filter (status included, via `onPriorityDrillDown`).
// KPI cards are unchanged — they still navigate directly, exactly as before.
//
// `selectedEmployee`/`onClearEmployee`/`onClearAll` are optional, passed
// only by the Admin dashboard (DashboardPage.jsx's variant="full") once it
// has an Employee Workload row selected — the Employee/User personal
// dashboard never passes them, so its Active Filters row stays exactly the
// single Status-only chip it has always been.
export default function TicketStatsSummary({
  stats, goToTickets, selectedStatus, onStatusSelect, onPriorityDrillDown,
  selectedEmployee, onClearEmployee, onClearAll,
}) {
  const { kpis, byStatus, byPriority, trend } = stats;
  const hasCrossFilter = typeof onStatusSelect === "function";
  const hasActiveFilters = (hasCrossFilter && selectedStatus) || selectedEmployee;
  const handleClearAll = onClearAll || (() => onStatusSelect(null));

  const handlePriorityClick = (entry) => {
    if (onPriorityDrillDown) {
      onPriorityDrillDown(entry);
    } else {
      goToTickets({ priorityId: entry.id });
    }
  };

  return (
    // Same Stack-based vertical rhythm as AgentDashboardPage.jsx's Manager/
    // Team Lead views (DASHBOARD_SECTION_SPACING, shared from theme.js) so
    // the gap between the KPI row and the charts below reads identically on
    // every role's dashboard. Stack's spacing only applies between actually-
    // rendered children, so an inactive Active Filters row (the `&&` below
    // evaluating to `false`) contributes no DOM node and therefore no extra
    // gap — the KPI-to-chart spacing is the same whether or not a filter is
    // active.
    <Stack spacing={DASHBOARD_SECTION_SPACING}>
      {/* Flex row + gap, not MUI's legacy Grid — Grid's negative-margin/
          width:calc() trick to fake spacing between items subtly bled its
          container a few pixels wider than its true parent width, which is
          why this row (and the chart row below) used to sit slightly right
          of the Department/Employee Workload card beneath them (a plain
          Paper, unaffected by that trick). Every card row in this file now
          shares this exact flex+gap pattern — the same one
          AgentDashboardPage.jsx's KPI row already used — so every section's
          outer left/right edges line up exactly, with zero Grid math to
          drift out of sync. */}
      <Box sx={{ display: "flex", flexWrap: { xs: "wrap", md: "nowrap" }, gap: 2 }}>
        <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
          <KpiCard label="Total" value={kpis.total} color="#c81e2a" icon={<ConfirmationNumberIcon />} onClick={() => goToTickets({})} />
        </Box>
        <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
          <KpiCard label="Open" value={kpis.open} color="#c81e2a" icon={<PendingActionsIcon />} onClick={() => goToTickets({ status: "OPEN" })} />
        </Box>
        <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
          <KpiCard label="In Progress" value={kpis.in_progress} color="#eb6834" icon={<HourglassBottomIcon />} onClick={() => goToTickets({ status: "IN_PROGRESS" })} />
        </Box>
        <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
          <KpiCard label="On Hold" value={kpis.on_hold} color="#eda100" icon={<PauseCircleOutlineIcon />} onClick={() => goToTickets({ status: "ON_HOLD" })} />
        </Box>
        <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
          <KpiCard label="Resolved" value={kpis.resolved} color="#0ca30c" icon={<TaskAltIcon />} onClick={() => goToTickets({ status: "RESOLVED" })} />
        </Box>
        <Box sx={{ flex: { xs: "1 1 45%", sm: "1 1 30%", md: "1 1 0" }, minWidth: 0 }}>
          <KpiCard label="Closed" value={kpis.closed} color="#898781" onClick={() => goToTickets({ status: "CLOSED" })} />
        </Box>
      </Box>

      {hasActiveFilters && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" fontWeight={600} color="text.secondary">Active Filters:</Typography>
          {selectedEmployee && (
            <Chip
              label={`Employee: ${selectedEmployee.name}`}
              size="small"
              color="primary"
              variant="outlined"
              onDelete={onClearEmployee}
            />
          )}
          {hasCrossFilter && selectedStatus && (
            <Chip
              label={`Status: ${selectedStatus.replace("_", " ")}`}
              size="small"
              color="primary"
              variant="outlined"
              onDelete={() => onStatusSelect(null)}
            />
          )}
          <Button size="small" onClick={handleClearAll}>Clear All Filters</Button>
        </Stack>
      )}

      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <StatusPieChart
            data={byStatus}
            selectedStatus={hasCrossFilter ? selectedStatus : undefined}
            onSliceClick={hasCrossFilter ? (status) => onStatusSelect(selectedStatus === status ? null : status) : (status) => goToTickets({ status })}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <PriorityBarChart data={byPriority} onBarClick={handlePriorityClick} />
        </Box>
      </Box>

      {/* TrendLineChart already wraps itself in a full-width Paper (same as
          Status/PriorityBarChart above) — no Grid/Box wrapper needed here at
          all, so it's a plain block-level sibling with the exact same box
          model as the Department/Employee Workload card below it. */}
      <TrendLineChart data={trend} />
    </Stack>
  );
}
