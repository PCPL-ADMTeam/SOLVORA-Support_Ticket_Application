import { Timeline, TimelineItem, TimelineSeparator, TimelineDot, TimelineConnector, TimelineContent, TimelineOppositeContent } from "@mui/lab";
import { Typography, Box } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { format } from "date-fns";
import { diffText, commentHtmlToText } from "../../utils/textDiff";

// Theme-aware red/green for removed/added text (readable in light and dark).
const delSx = (theme) => ({
  color: theme.palette.mode === "dark" ? theme.palette.error.light : theme.palette.error.dark,
  bgcolor: alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.22 : 0.12),
});
const insSx = (theme) => ({
  color: theme.palette.mode === "dark" ? theme.palette.success.light : theme.palette.success.dark,
  bgcolor: alpha(theme.palette.success.main, theme.palette.mode === "dark" ? 0.22 : 0.14),
});
// Comment text keeps its own spaces, tabs and line breaks, and wraps.
const textBlockSx = { mt: 0.5, px: 1, py: 0.5, borderRadius: 1, whiteSpace: "pre-wrap", wordBreak: "break-word", typography: "body2" };

// "Comment edited": one inline comparison (removed = red + strikethrough,
// added = green), or both full texts when nothing in common. Older entries
// recorded before text snapshots existed show a neutral note instead.
function CommentEditDiff({ metadata }) {
  if (typeof metadata?.oldText !== "string" || typeof metadata?.newText !== "string") {
    return <Typography variant="caption" color="text.secondary">Comment text changes unavailable</Typography>;
  }
  const oldText = commentHtmlToText(metadata.oldText);
  const newText = commentHtmlToText(metadata.newText);
  const { parts, fullReplacement } = diffText(oldText, newText);
  if (fullReplacement) {
    return (
      <Box>
        {oldText && <Box sx={(theme) => ({ ...textBlockSx, ...delSx(theme), textDecoration: "line-through" })}>{oldText}</Box>}
        {newText && <Box sx={(theme) => ({ ...textBlockSx, ...insSx(theme) })}>{newText}</Box>}
      </Box>
    );
  }
  return (
    <Box sx={{ ...textBlockSx, px: 0, color: "text.primary" }}>
      {parts.map((part, i) =>
        part.type === "same" ? (
          <span key={i}>{part.text}</span>
        ) : (
          <Box
            key={i}
            component={part.type === "del" ? "del" : "ins"}
            sx={(theme) => ({ ...(part.type === "del" ? delSx(theme) : insSx(theme)), borderRadius: 0.5, px: 0.25, textDecoration: part.type === "del" ? "line-through" : "none" })}
          >
            {part.text}
          </Box>
        )
      )}
    </Box>
  );
}

// "Comment deleted": the text captured at deletion time, in red.
function DeletedCommentText({ metadata }) {
  if (typeof metadata?.deletedText !== "string") {
    return <Typography variant="caption" color="text.secondary">Deleted comment text unavailable</Typography>;
  }
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">Deleted comment:</Typography>
      <Box sx={(theme) => ({ ...textBlockSx, ...delSx(theme), mt: 0.25, borderLeft: 3, borderColor: "error.main" })}>
        {commentHtmlToText(metadata.deletedText)}
      </Box>
    </Box>
  );
}

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
  COMMENT_EDITED: "Comment edited",
  COMMENT_DELETED: "Comment deleted",
  BULK_UPDATE: "Bulk updated",
};

const ACTION_COLORS = {
  CREATED: "primary",
  STATUS_CHANGE: "warning",
  ASSIGNED: "info",
  COMMENTED: "grey",
  COMMENT_EDITED: "grey",
  COMMENT_DELETED: "grey",
  RESOLUTION_NOTES: "success",
  ON_HOLD_REASON: "warning",
  CLOSED_REASON: "grey",
  DEPARTMENT_TRANSFERRED: "info",
  TRANSFER_REASON: "grey",
};

// No "Activity History" heading here — the parent page (TicketDetailPage.jsx)
// now shows this inside its own "Activity History" tab, whose label already
// serves as the section's title; repeating it here would just duplicate it.
export default function ActivityTimeline({ history }) {
  if (!history.length) return null;

  return (
    <Box>
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
              {h.action === "COMMENT_EDITED" && <CommentEditDiff metadata={h.metadata} />}
              {h.action === "COMMENT_DELETED" && <DeletedCommentText metadata={h.metadata} />}
            </TimelineContent>
          </TimelineItem>
        ))}
      </Timeline>
    </Box>
  );
}
