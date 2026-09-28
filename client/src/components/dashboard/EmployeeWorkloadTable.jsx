import { Paper, Box, Typography, IconButton, Tooltip, Table, TableHead, TableBody, TableRow, TableCell, Chip } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

// Department-level view of per-employee ticket load — a manager needs the
// Open/In Progress/Resolved/Closed breakdown to see who's actively working
// something vs. who's free to take on more. Backed by the same
// /dashboard/stats `workload` array (see dashboard.service.js), which is
// already scoped to whichever single department is currently selected (a
// Team Lead's own department, or the department an Admin/Manager just
// drilled into from Department Workload — see DashboardPage.jsx/
// AgentDashboardPage.jsx). This array is always the full, unfiltered
// snapshot (never re-scoped to whichever employee is currently selected) —
// clicking a row sets the dashboard's own cross-filter, it never changes
// what this table itself lists.
// `selectedEmployeeId`/`onSelectEmployee` are optional — omitting both
// keeps every row exactly as plain/non-interactive as before. `title`
// defaults to the plain "Employee Workload" heading Team Lead has always
// shown; Admin/Manager pass a department-qualified title once they've
// drilled into one (e.g. "Employee Workload — BI/Copilot"). `onBack` is
// also optional and Admin/Manager-only — when passed (only once a specific
// department is selected), a small icon-only arrow appears before the
// title to return to the aggregate Department Workload view, clearing both
// the selected department AND employee at once (see DashboardPage.jsx/
// AgentDashboardPage.jsx). Team Lead never passes it — they have no "all
// departments" level to return to, so their heading stays exactly as before.
export default function EmployeeWorkloadTable({ workload, selectedEmployeeId, onSelectEmployee, title = "Employee Workload", onBack }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
        {onBack && (
          <Tooltip title="Back to all departments">
            <IconButton size="small" onClick={onBack} sx={{ color: "primary.main", ml: -0.75 }}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
      </Box>
      {workload.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No active employees in this department yet.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Employee</TableCell>
              <TableCell align="right">Open</TableCell>
              <TableCell align="right">In Progress</TableCell>
              <TableCell align="right">Resolved</TableCell>
              <TableCell align="right">Closed</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {workload.map((w) => (
              <TableRow
                key={w.agentId}
                hover
                selected={onSelectEmployee ? selectedEmployeeId === w.agentId : false}
                onClick={onSelectEmployee ? () => onSelectEmployee(w) : undefined}
                sx={onSelectEmployee ? { cursor: "pointer" } : undefined}
              >
                <TableCell>{w.agentName}</TableCell>
                <TableCell align="right">
                  {w.openTickets > 0 ? (
                    <Chip size="small" label={w.openTickets} color="warning" variant="outlined" />
                  ) : (
                    <Chip size="small" label="0" variant="outlined" />
                  )}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{w.inProgressTickets}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{w.resolvedTickets}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{w.closedTickets}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}
