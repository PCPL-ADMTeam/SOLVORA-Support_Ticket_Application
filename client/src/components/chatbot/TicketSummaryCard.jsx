import { Box, Stack, Typography } from "@mui/material";
import { format, formatDistanceToNow } from "date-fns";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import EventOutlinedIcon from "@mui/icons-material/EventOutlined";
import UpdateIcon from "@mui/icons-material/Update";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import { StatusChip, PriorityChip } from "./TicketChips";
import { CardFrame, Callout } from "./response/parts";

const when = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const full = (iso) => (when(iso) ? format(when(iso), "MMM d, yyyy, h:mm a") : null);

// One labelled fact with its icon. A missing value says what is missing in plain words (never guessed).
function Fact({ icon: Icon, label, value, missing = "Not recorded" }) {
  return (
    <Box sx={{ display: "flex", gap: 1, minWidth: 0 }}>
      <Icon aria-hidden sx={{ fontSize: 18, mt: 0.25, color: "var(--sv-accent-ink)" }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ display: "block", color: "var(--sv-muted)", lineHeight: 1.3 }}>
          {label}
        </Typography>
        <Typography variant="body2" sx={{ wordBreak: "break-word", fontWeight: value ? 600 : 400, color: value ? "var(--sv-text)" : "var(--sv-muted)" }}>
          {value || missing}
        </Typography>
      </Box>
    </Box>
  );
}

function SectionLabel({ icon: Icon, children }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1.5, mb: 0.5 }}>
      <Icon aria-hidden sx={{ fontSize: 16, color: "var(--sv-accent-ink)" }} />
      <Typography variant="caption" fontWeight={800} sx={{ color: "var(--sv-text)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {children}
      </Typography>
    </Stack>
  );
}

// Ticket details (see docs/chatbot-api.md for the summary contract). Only fields the server already
// authorized are shown; a missing value is named as missing, never guessed. Recorded facts and
// suggestions are kept visibly apart.
export default function TicketSummaryCard({ summary, compact = false }) {
  if (!summary) return null;
  const updated = when(summary.latestUpdateAt);
  const latestText = summary.latestUpdateText || (summary.latestUpdate ? summary.latestUpdate.replace(/\s*\(\d{4}-\d{2}-\d{2}T[^)]*\)\s*$/, "") : null);
  return (
    <CardFrame
      label={`Summary of ticket ${summary.ticketId}`}
      icon={ConfirmationNumberOutlinedIcon}
      title={`Ticket #${summary.ticketId}`}
      subtitle={summary.subject}
      badge={
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <StatusChip status={summary.status} />
          {summary.priority && <PriorityChip name={summary.priority} />}
        </Stack>
      }
    >
      {summary.summary && (
        <Box sx={{ p: 1.1, borderRadius: "10px", bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)" }}>
          <Typography variant="caption" fontWeight={700} sx={{ color: "var(--sv-muted)" }}>
            Problem
          </Typography>
          <Typography variant="body2" sx={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
            {summary.summary}
          </Typography>
        </Box>
      )}

      {!compact && (
        <>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(150px, 100%), 1fr))", gap: 1.25, mt: summary.summary ? 1.5 : 0 }}>
            <Fact icon={PersonOutlineIcon} label="Raised by" value={summary.raisedBy} />
            <Fact icon={AssignmentIndOutlinedIcon} label="Assigned to" value={summary.assignedTo} missing="Not assigned yet" />
            <Fact icon={BusinessOutlinedIcon} label="Department" value={summary.department} />
            <Fact icon={CategoryOutlinedIcon} label="Category" value={summary.category} missing="Not set" />
            <Fact icon={EventOutlinedIcon} label="Created" value={full(summary.createdAt)} />
            <Fact icon={UpdateIcon} label="Last updated" value={full(summary.lastUpdatedAt)} />
          </Box>

          <SectionLabel icon={UpdateIcon}>Latest update</SectionLabel>
          {latestText ? (
            <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
              {latestText}
              {updated && (
                <Typography component="span" variant="caption" title={full(summary.latestUpdateAt)} sx={{ ml: 0.75, color: "var(--sv-muted)" }}>
                  {formatDistanceToNow(updated, { addSuffix: true })}
                </Typography>
              )}
            </Typography>
          ) : (
            <Typography variant="body2" sx={{ color: "var(--sv-muted)" }}>
              No update recorded yet.
            </Typography>
          )}

          {summary.resolutionSummary && (
            <Box sx={{ mt: 1.5 }}>
              <Callout tone="ok" icon={TaskAltIcon} label="Resolution">
                <Typography variant="caption" fontWeight={700} sx={{ display: "block", color: "var(--sv-muted)" }}>
                  Resolution (recorded)
                </Typography>
                <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                  {summary.resolutionSummary}
                </Typography>
              </Callout>
            </Box>
          )}

          <SectionLabel icon={PendingActionsOutlinedIcon}>What&apos;s pending</SectionLabel>
          {summary.pendingActions?.length ? (
            <Box component="ul" sx={{ m: 0, pl: 2.5, display: "grid", gap: 0.25 }}>
              {summary.pendingActions.map((p) => (
                <Typography component="li" key={p} variant="body2">
                  {p}
                </Typography>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" sx={{ color: "var(--sv-muted)" }}>
              Nothing recorded as pending.
            </Typography>
          )}

          {summary.suggestions?.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Callout tone="info" icon={LightbulbOutlinedIcon} label="Suggestion">
                <Typography variant="caption" fontWeight={700} sx={{ display: "block", color: "var(--sv-muted)" }}>
                  Suggestion (not a recorded fact)
                </Typography>
                {summary.suggestions.map((s) => (
                  <Typography key={s} variant="body2">
                    {s}
                  </Typography>
                ))}
              </Callout>
            </Box>
          )}

          {summary.slaStatus === "Not tracked" && (
            <Typography variant="caption" display="block" sx={{ mt: 1.25, color: "var(--sv-muted)" }}>
              SLA and due dates are not tracked in this application.
            </Typography>
          )}
        </>
      )}
    </CardFrame>
  );
}
