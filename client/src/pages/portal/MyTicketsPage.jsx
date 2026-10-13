import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Box, Stack, Tabs, Tab, Typography, ToggleButtonGroup, ToggleButton } from "@mui/material";
import TicketsListPage from "../TicketsListPage";
import { useAuth } from "../../context/AuthContext";

// Employee Ticket Log — same structure as the Team Lead queue
// (AgentQueuePage.jsx): main tabs `?view=my|department`, and within My
// Tickets the `?scope=created|assigned` sub-tabs (Raised By Me / Assigned
// To Me; dashboard KPI links already navigate here with ?scope=).
//
// Every tab maps to a server-side scope (ticket.service.js#listTickets ->
// utils/ticketAccess.js#scopeWhereForTab): "created" = requesterId = me,
// "assigned" = assigneeId = me, "department" = the employee's own
// department, resolved on the server — no department id is sent from here.
// `key` remounts the list per tab so each tab keeps its own filters and
// Clear only resets the active one.
export default function MyTicketsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const view = searchParams.get("view") === "department" ? "department" : "my";
  const isMy = view === "my";
  const myScope = searchParams.get("scope") === "assigned" ? "assigned" : "created";
  const hasDepartment = Boolean(user.department?.id || user.departmentId);

  const handleViewChange = (_, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("view", value);
      if (value === "department") next.delete("scope");
      return next;
    });
  };
  const handleMyScopeChange = (_, value) => {
    if (!value) return; // ToggleButtonGroup fires with null when the active button is clicked again
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("view", "my");
      next.set("scope", value);
      return next;
    });
  };

  const additionalFilters = useMemo(() => ({ scope: isMy ? myScope : "department" }), [isMy, myScope]);

  return (
    <Stack spacing={2}>
      <Typography variant="h4">{isMy ? "My Tickets" : "Department Tickets"}</Typography>

      <Tabs value={view} onChange={handleViewChange} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tab label="My Tickets" value="my" id="employee-tickets-my-tab" />
        <Tab label="Department Tickets" value="department" id="employee-tickets-department-tab" />
      </Tabs>

      {isMy && (
        <ToggleButtonGroup exclusive size="small" value={myScope} onChange={handleMyScopeChange}>
          <ToggleButton value="created" sx={{ minWidth: 140, justifyContent: "center" }}>Raised By Me</ToggleButton>
          <ToggleButton value="assigned" sx={{ minWidth: 140, justifyContent: "center" }}>Assigned To Me</ToggleButton>
        </ToggleButtonGroup>
      )}

      {!isMy && !hasDepartment && (
        <Alert severity="info">Your account has no department assigned, so there are no department tickets to show. Contact an administrator.</Alert>
      )}

      <Box>
        <TicketsListPage
          key={isMy ? `my-${myScope}` : "department"}
          hideHeading
          showRequester={!isMy || myScope === "assigned"}
          showAssignee={!isMy || myScope === "created"}
          showAssigneeFilter={!isMy}
          showAssignedFilter={!isMy}
          assignedFilterLabel="Assignment State"
          highlightUnassigned={!isMy}
          additionalFilters={additionalFilters}
        />
      </Box>
    </Stack>
  );
}
