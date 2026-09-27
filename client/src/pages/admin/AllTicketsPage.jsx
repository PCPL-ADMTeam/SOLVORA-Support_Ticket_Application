import TicketsListPage from "../TicketsListPage";

// ADMIN sees the organization-wide ticket list (see
// ticket.service.js#scopeWhereForUser — ADMIN's scope is unrestricted) with
// the richest filter set, since they can legitimately search/filter across
// every department.
export default function AllTicketsPage() {
  return (
    <TicketsListPage
      title="All Tickets"
      showAssignee
      showAssigneeFilter
      showRequester
      showDepartmentFilter
      showAssignedFilter
      showBulkActions
    />
  );
}
