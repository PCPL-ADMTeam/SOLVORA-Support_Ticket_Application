import { Box, Divider, Paper, Stack, Typography } from "@mui/material";
import { format } from "date-fns";
import StatusBadge from "../common/StatusBadge";
import PriorityBadge from "../common/PriorityBadge";

const fmt = (iso) => (iso ? format(new Date(iso), "MMM d, yyyy h:mm a") : null);

function Fact({ label, value }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ color: "var(--sv-muted)" }} variant="caption" display="block">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
        {value || <em>Not available</em>}
      </Typography>
    </Box>
  );
}

// Ticket summary contract (see docs/chatbot-api.md). Missing values are shown
// as "Not available" — never guessed. Recorded facts and suggestions are
// visually separated.
export default function TicketSummaryCard({ summary, compact = false }) {
  if (!summary) return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mt: 1, bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)", borderRadius: "14px", color: "var(--sv-text)" }} aria-label={`Summary of ticket ${summary.ticketId}`}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2" fontWeight={700}>
          #{summary.ticketId}
        </Typography>
        <StatusBadge status={summary.status} />
        {summary.priority && <PriorityBadge name={summary.priority} />}
      </Stack>
      <Typography variant="body2" fontWeight={600} sx={{ mt: 0.5, wordBreak: "break-word" }}>
        {summary.subject}
      </Typography>
      {summary.summary && (
        <Typography variant="body2" sx={{ color: "var(--sv-muted)", wordBreak: "break-word" }}>
          {summary.summary}
        </Typography>
      )}

      {!compact && (
        <>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1, mt: 1.5 }}>
            <Fact label="Raised by" value={summary.raisedBy} />
            <Fact label="Assigned to" value={summary.assignedTo} />
            <Fact label="Department" value={summary.department} />
            <Fact label="Created" value={fmt(summary.createdAt)} />
            <Fact label="Last updated" value={fmt(summary.lastUpdatedAt)} />
            <Fact label="Category" value={summary.category} />
            <Fact label="SLA" value={summary.slaStatus} />
          </Box>

          <Divider sx={{ my: 1.5 }} />
          <Typography sx={{ color: "var(--sv-muted)" }} variant="caption" display="block">
            Latest update
          </Typography>
          <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
            {summary.latestUpdate || <em>Not available</em>}
          </Typography>

          {summary.resolutionSummary && (
            <>
              <Typography variant="caption" display="block" sx={{ color: "var(--sv-muted)", mt: 1 }}>
                Resolution (recorded)
              </Typography>
              <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                {summary.resolutionSummary}
              </Typography>
            </>
          )}

          <Typography variant="caption" display="block" sx={{ color: "var(--sv-muted)", mt: 1 }}>
            Pending (from recorded data)
          </Typography>
          {summary.pendingActions.length ? (
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {summary.pendingActions.map((p) => (
                <li key={p}>
                  <Typography variant="body2">{p}</Typography>
                </li>
              ))}
            </Box>
          ) : (
            <Typography variant="body2">Nothing recorded as pending.</Typography>
          )}

          {summary.suggestions?.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ color: "var(--sv-muted)" }} variant="caption" display="block">
                Suggestion (not a recorded fact)
              </Typography>
              {summary.suggestions.map((s) => (
                <Typography key={s} variant="body2" sx={{ fontStyle: "italic" }}>
                  {s}
                </Typography>
              ))}
            </Box>
          )}
        </>
      )}
    </Paper>
  );
}
