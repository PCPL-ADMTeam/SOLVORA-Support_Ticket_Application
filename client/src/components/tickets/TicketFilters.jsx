import { useEffect, useState } from "react";
import { Paper, Stack, TextField, MenuItem, InputAdornment, Button, Autocomplete } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { prioritiesApi } from "../../api/catalog";
import { usersApi } from "../../api/users";
import { departmentsApi } from "../../api/departments";
import { useAuth } from "../../context/AuthContext";

const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "REOPENED"];
const ASSIGNED_OPTIONS = [
  { value: "", label: "All" },
  { value: "true", label: "Assigned" },
  { value: "false", label: "Unassigned" },
];

// Search/status/priority/date-range filters for every ticket list, plus a
// set of role-gated extras (Department/Assignee/Assigned) that a caller
// opts into individually — never all shown at once, so ADMIN can get the
// richest filter set while MANAGER/TEAMLEAD/EMPLOYEE only see what's
// relevant to their authorized scope (see TicketsListPage.jsx's callers for
// exactly which
// flags each role passes). Every filter here only NARROWS the request sent
// to GET /tickets; the backend (ticket.service.js#listTickets) is what
// actually enforces the role-based authorization scope — this component
// has no say over what a request is allowed to return.
export default function TicketFilters({ filters, onChange, showAssigneeFilter, showDepartmentFilter, showAssignedFilter }) {
  const { user } = useAuth();
  const [priorities, setPriorities] = useState([]);
  const [agents, setAgents] = useState([]);
  const [departments, setDepartments] = useState([]);
  // Restricts the Department filter's SELECTABLE options for a MANAGER/
  // TEAMLEAD to only the departments they have UserDepartmentAccess to —
  // departments they lack access to must never be offered as a filter
  // choice, even though `departments` itself (below) still loads every
  // department's full record since GET /departments is readable by any
  // authenticated user. null = not a management role, so no restriction
  // applies.
  const [myDepartmentIds, setMyDepartmentIds] = useState(null);

  useEffect(() => {
    prioritiesApi.list().then(({ data }) => setPriorities(data.data));
    // Already department-scoped for a MANAGER/TEAMLEAD caller server-side
    // (user.service.js#listAssignableEmployees) — never every employee.
    if (showAssigneeFilter) usersApi.assignableAgents().then(({ data }) => setAgents(data.data));
  }, [showAssigneeFilter]);

  useEffect(() => {
    // GET /departments is readable by any authenticated user (the ticket
    // form already relies on this), so this is not a new access grant.
    if (showDepartmentFilter) departmentsApi.list().then(({ data }) => setDepartments(data.data));
  }, [showDepartmentFilter]);

  useEffect(() => {
    if (showDepartmentFilter && (user.role.name === "MANAGER" || user.role.name === "TEAMLEAD")) {
      usersApi.myDepartmentAccess().then(({ data }) => setMyDepartmentIds(new Set(data.data.map((d) => d.id))));
    }
  }, [showDepartmentFilter, user.role.name]);

  const departmentOptions = myDepartmentIds ? departments.filter((d) => myDepartmentIds.has(d.id)) : departments;

  const set = (field) => (e) => onChange({ ...filters, [field]: e.target.value, page: 1 });

  const handleDepartmentChange = (e) => {
    onChange({ ...filters, departmentId: e.target.value, page: 1 });
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
        {/* <TextField
          size="small"
          placeholder="Search title, requester, assignee..."
          value={filters.search || ""}
          onChange={set("search")}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          sx={{ minWidth: 240 }}
        /> */}
        <TextField size="small" select label="Status" value={filters.status || ""} onChange={set("status")} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {STATUS_OPTIONS.map((s) => <MenuItem key={s} value={s}>{s.replace("_", " ")}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Priority" value={filters.priorityId || ""} onChange={set("priorityId")} sx={{ minWidth: 140 }}>
          <MenuItem value="">All</MenuItem>
          {priorities.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
        </TextField>
        {showDepartmentFilter && (
          <TextField size="small" select label="Department" value={filters.departmentId || ""} onChange={handleDepartmentChange} sx={{ minWidth: 160 }}>
            <MenuItem value="">All Departments</MenuItem>
            {departmentOptions.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
          </TextField>
        )}
        {showAssigneeFilter && (
          // A type-to-filter Autocomplete (not a giant static Select) over
          // the already-fetched, already-correctly-scoped `agents` list
          // (department-limited for Manager/Team Lead, org-wide for Admin —
          // see the effect above) rather than a second live search, so an
          // Admin filtering across a 100+-employee organization can still
          // just type a name instead of scrolling a huge dropdown.
          <Autocomplete
            size="small"
            sx={{ minWidth: 200 }}
            options={agents}
            getOptionLabel={(a) => a.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            value={agents.find((a) => a.id === filters.assigneeId) || null}
            onChange={(_e, option) => onChange({ ...filters, assigneeId: option?.id || "", page: 1 })}
            renderInput={(params) => <TextField {...params} label="Assignee" placeholder="Search assignee..." />}
          />
        )}
        {showAssignedFilter && (
          <TextField size="small" select label="Assigned" value={filters.assigned || ""} onChange={set("assigned")} sx={{ minWidth: 140 }}>
            {ASSIGNED_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
        )}
        <TextField size="small" type="date" label="From" value={filters.dateFrom || ""} onChange={set("dateFrom")} InputLabelProps={{ shrink: true }} />
        <TextField size="small" type="date" label="To" value={filters.dateTo || ""} onChange={set("dateTo")} InputLabelProps={{ shrink: true }} />
        <Button size="small" onClick={() => onChange({ page: 1, limit: filters.limit })}>Clear</Button>
      </Stack>
    </Paper>
  );
}
