import { Paper, Typography, Table, TableHead, TableBody, TableRow, TableCell, Chip } from "@mui/material";

// Admin "All Departments" / Manager "All Accessible Departments" view — one
// row per department the caller may see, backed by the same /dashboard/stats
// `departmentWorkload` array (see dashboard.service.js), which is already
// scoped server-side (every department for Admin, only the caller's own
// UserDepartmentAccess departments for a Manager). Clicking a row sets the
// dashboard's own Department filter (see DashboardPage.jsx), which then
// swaps this table out for EmployeeWorkloadTable.jsx scoped to that one
// department — the same drill-down pattern EmployeeWorkloadTable's own row
// click already uses for the Employee filter.
export default function DepartmentWorkloadTable({ departments, onSelectDepartment }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>Department Workload</Typography>
      {departments.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No departments to show yet.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Department</TableCell>
              <TableCell align="right">Open</TableCell>
              <TableCell align="right">In Progress</TableCell>
              <TableCell align="right">Resolved</TableCell>
              <TableCell align="right">Closed</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {departments.map((d) => (
              <TableRow
                key={d.departmentId}
                hover
                onClick={onSelectDepartment ? () => onSelectDepartment(d) : undefined}
                sx={onSelectDepartment ? { cursor: "pointer" } : undefined}
              >
                <TableCell>{d.departmentName}</TableCell>
                <TableCell align="right">
                  {d.openTickets > 0 ? (
                    <Chip size="small" label={d.openTickets} color="warning" variant="outlined" />
                  ) : (
                    <Chip size="small" label="0" variant="outlined" />
                  )}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{d.inProgressTickets}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{d.resolvedTickets}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{d.closedTickets}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}
