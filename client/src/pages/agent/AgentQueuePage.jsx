import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Box, Stack, Tabs, Tab, Typography, ToggleButtonGroup, ToggleButton } from "@mui/material";
import TicketsListPage from "../TicketsListPage";
import { useAuth } from "../../context/AuthContext";

// ONE page (/agent/queue), ONE ticket list at a time, driven by `?view=`
// ("my", default, or "department") and, within "my", `?scope=` ("created",
// default = Raised by Me, or "assigned" = Assigned to Me). This is NOT
// separate sidebar pages; switching either control only changes this
// component's own content, it never navigates away from /agent/queue.
// `key` forces a clean remount on switch so TicketsListPage's own internal
// filter state (status/search/etc, initialized once from the URL) never
// leaks between fundamentally different ticket sets.
//
// Backend scopes reused as-is (ticket.service.js#scopeWhereForTab):
// scope=created -> requesterId = me, regardless of department; scope=
// assigned -> assigneeId = me. Both are self-sufficient authorization
// rules the server already enforces — this page only ever selects WHICH
// of the server's own scopes to request, never filters a full dataset
// client-side.
export default function AgentQueuePage() {
  const { user } = useAuth();
  const isManager = user.role.name === "MANAGER";
  const [searchParams, setSearchParams] = useSearchParams();
  // Global header search (see AppShell.jsx) lands here as plain
  // `?search=...`, with NO `view` of its own — it means "search everything
  // I'm authorized to see," not "search only what I personally raised." So
  // the default view when `view` is entirely absent depends on whether a
  // search is active: no search -> "my" (the existing default, e.g. from
  // the sidebar "Tickets" link); a search present -> "department" (the
  // broadest tab an Agent has), so a department ticket the Agent didn't
  // raise is still found instead of silently narrowed to Raised by Me. An
  // EXPLICIT ?view=my|department (from actually clicking a tab) always
  // wins either way.
  // Global search mode: arrived with a search term but no EXPLICIT tab
  // choice — the query must use the broadest "authorized" scope (every
  // ticket this Agent may view: department + anything they personally
  // raised, see ticket.service.js#scopeWhereForTab's "authorized" branch),
  // never a tab's own restrictive scope. The moment the Agent explicitly
  // clicks a tab (?view= appears in the URL), that tab's real scope takes
  // over exactly as before — this only affects the unparameterized
  // "just searched" landing state.
  const isGlobalSearch = !searchParams.has("view") && Boolean(searchParams.get("search"));
  // Department Tickets is shown as the active tab in this state purely as
  // the least-misleading visual (an unhighlighted Tabs value would render
  // with no indicator at all) — it does NOT mean department-only scope is
  // actually applied; see additionalFilters below.
  const view = searchParams.has("view")
    ? (searchParams.get("view") === "department" ? "department" : "my")
    : (isGlobalSearch || isManager ? "department" : "my");
  const isMy = view === "my";
  // A Manager has no "Assigned to Me" data (never a ticket assignee — see
  // the final role rules), so their My Tickets tab is always Raised by Me
  // regardless of any stale ?scope= left in the URL.
  const myScope = !isManager && searchParams.get("scope") === "assigned" ? "assigned" : "created";

  // Merges into the CURRENT params rather than replacing them outright, so
  // switching tabs/sub-scope never silently drops an active `search` (or
  // any other filter) — e.g. searching "HW-0034" then clicking "My Tickets"
  // must keep searching for "HW-0034", now narrowed to that scope, not
  // reset to an unfiltered My Tickets list.
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

  // "" for scope on the department side deliberately clears any stale
  // ?scope= left over in the URL (e.g. an old bookmark), guaranteeing the
  // department view is never accidentally narrowed by a leftover personal
  // scope.
  const additionalFilters = useMemo(
    () => (isGlobalSearch ? { scope: "authorized" } : isMy ? { scope: myScope } : { scope: "" }),
    [isGlobalSearch, isMy, myScope]
  );

  return (
    <Stack spacing={2}>
      <Typography variant="h4">{isMy ? "My Tickets" : "Department Tickets"}</Typography>

      <Tabs value={view} onChange={handleViewChange} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tab label="My Tickets" value="my" id="agent-tickets-my-tab" />
        <Tab label="Department Tickets" value="department" id="agent-tickets-department-tab" />
      </Tabs>

      {isMy && !isManager && (
        <ToggleButtonGroup exclusive size="small" value={myScope} onChange={handleMyScopeChange}>
          <ToggleButton value="created" sx={{ minWidth: 140, justifyContent: "center" }}>Raised by Me</ToggleButton>
          <ToggleButton value="assigned" sx={{ minWidth: 140, justifyContent: "center" }}>Assigned to Me</ToggleButton>
        </ToggleButtonGroup>
      )}

      <Box>
        <TicketsListPage
          key={isMy ? `my-${myScope}` : "department"}
          hideHeading
          showRequester
          showAssignee={!isMy || myScope === "created"}
          showAssigneeFilter={!isMy}
          showAssignedFilter={!isMy}
          // Department column is always shown now — a Manager's Department
          // Tickets tab can span every department they have access to. The
          // Department FILTER dropdown, however, is Manager-only — a Team
          // Lead has exactly one department and nothing to choose between
          // (see the final role rules — "Do NOT show [All Departments]" for
          // Team Lead).
          showDepartmentFilter={!isMy && isManager}
          highlightUnassigned={!isMy}
          additionalFilters={additionalFilters}
        />
      </Box>
    </Stack>
  );
}
