import { Timeline, TimelineItem, TimelineSeparator, TimelineDot, TimelineConnector, TimelineContent, TimelineOppositeContent } from "@mui/lab";
import { Typography, Box } from "@mui/material";
import { format } from "date-fns";

const ACTION_LABELS = {
  CREATED: "Ticket created",
  STATUS_CHANGE: "Status changed",
  ASSIGNED: "Reassigned",
  TEAM_CHANGE: "Team changed",
  PRIORITY_CHANGE: "Priority changed",
  CATEGORY_CHANGE: "Category changed",
  DEPARTMENT_CHANGE: "Department changed",
  MANAGER_CHANGE: "Manager changed",
  ISSUE_CHANGE: "Issue changed",
  TICKET_DETAILS_UPDATED: "Ticket details updated",
  RESOLUTION_NOTES: "Resolution notes",
  ON_HOLD_REASON: "On-hold reason",
  CLOSED_REASON: "Closed reason",
  DEPARTMENT_TRANSFERRED: "Department transferred",
  TRANSFER_REASON: "Transfer reason",
  COMMENTED: "Commented",
  BULK_UPDATE: "Bulk updated",
};

const ACTION_COLORS = {
  CREATED: "primary",
  STATUS_CHANGE: "warning",
  ASSIGNED: "info",
  COMMENTED: "grey",
  RESOLUTION_NOTES: "success",
  ON_HOLD_REASON: "warning",
  CLOSED_REASON: "grey",
  DEPARTMENT_TRANSFERRED: "info",
  TRANSFER_REASON: "grey",
};

export default function ActivityTimeline({ history }) {
  if (!history.length) return null;

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>Activity History</Typography>
      <Timeline sx={{ p: 0, m: 0 }}>
        {history.map((h, idx) => (
          <TimelineItem key={h.id}>
            <TimelineOppositeContent sx={{ flex: 0.3 }} color="text.secondary" variant="caption">
              {format(new Date(h.createdAt), "MMM d, h:mm a")}
            </TimelineOppositeContent>
            <TimelineSeparator>
              <TimelineDot color={ACTION_COLORS[h.action] || "grey"} />
              {idx < history.length - 1 && <TimelineConnector />}
            </TimelineSeparator>
            <TimelineContent>
              <Typography variant="body2" fontWeight={600}>
                {ACTION_LABELS[h.action] || h.action} <Typography component="span" variant="body2" color="text.secondary">by {h.user.name}</Typography>
              </Typography>
              {h.fieldName && (
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                  {/* Reassignment reads better as "Assigned to <name>" than
                      a generic "<old> → <new>" arrow — the "by <name>" on
                      the line above already identifies who performed the
                      action, so repeating the old assignee here would be
                      redundant. oldValue/newValue are always already
                      resolved, human-readable display names by this point
                      (see ticket.service.js#updateTicket) — never a raw
                      user id. */}
                  {h.action === "ASSIGNED"
                    ? `Assigned to ${h.newValue || "Unassigned"}`
                    : /* A note-only entry (RESOLUTION_NOTES/ON_HOLD_REASON/
                         CLOSED_REASON) has no "before" value — show the note
                         text on its own rather than a confusing "— → text". */
                      h.oldValue
                      ? `${h.oldValue} → ${h.newValue || "—"}`
                      : h.newValue || "—"}
                </Typography>
              )}
            </TimelineContent>
          </TimelineItem>
        ))}
      </Timeline>
    </Box>
  );
}
