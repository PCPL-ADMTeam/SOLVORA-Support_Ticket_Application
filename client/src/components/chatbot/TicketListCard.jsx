import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { interactiveCard, reducedMotion, focusRing } from "./theme/chatStyles";
import { format } from "date-fns";
import StatusBadge from "../common/StatusBadge";
import PriorityBadge from "../common/PriorityBadge";

// Renders the server's restricted ticket-card DTOs. Only fields the server
// already authorized and filtered arrive here; this component never fetches.
export default function TicketListCard({ tickets, total, onNavigate }) {
  if (!tickets?.length) return null;
  return (
    <Stack component="ul" spacing={1} sx={{ listStyle: "none", m: 0, p: 0, mt: 1 }} aria-label="Matching tickets">
      {tickets.map((t) => (
        <Paper component="li" key={t.ticketNumber} variant="outlined" sx={{ ...interactiveCard, cursor: "default", p: 1.5, bgcolor: "var(--sv-bg)", borderRadius: "14px" }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" fontWeight={700} sx={{ color: "var(--sv-accent-ink)" }}>
              #{t.ticketNumber}
            </Typography>
            <StatusBadge status={t.status} />
            {t.priority && <PriorityBadge name={t.priority.name} color={t.priority.color} />}
          </Stack>
          <Typography variant="body2" fontWeight={600} sx={{ mt: 0.5, wordBreak: "break-word", color: "var(--sv-text)" }}>
            {t.title}
          </Typography>
          <Typography variant="caption" display="block" sx={{ color: "var(--sv-muted)" }}>
            {[t.department, t.assignedTo ? `Assigned to ${t.assignedTo}` : "Unassigned"].filter(Boolean).join(" · ")}
            {t.createdAt ? ` · Created ${format(new Date(t.createdAt), "MMM d, yyyy")}` : ""}
            {t.lastUpdatedAt ? ` · Updated ${format(new Date(t.lastUpdatedAt), "MMM d, yyyy")}` : ""}
          </Typography>
          {t.reason && (
            <Box sx={{ mt: 0.75, p: 1, borderRadius: "10px", bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)" }}>
              <Typography variant="caption" sx={{ color: "var(--sv-muted)", fontWeight: 700 }}>
                {t.reason.label}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--sv-text)" }}>
                {t.reason.text || "No reason recorded."}
              </Typography>
            </Box>
          )}
          <Box sx={{ mt: 0.75 }}>
            <Button
              size="small"
              variant="contained"
              disableElevation
              sx={{ background: "var(--sv-accent-gradient)", color: "var(--sv-on-accent)", borderRadius: "10px", ...focusRing, ...reducedMotion }}
              onClick={() => onNavigate?.({ type: "route", path: `/tickets/${t.ticketRouteId}`, label: "Open ticket" })}
              aria-label={`Open ticket ${t.ticketNumber}`}
            >
              Open ticket
            </Button>
          </Box>
        </Paper>
      ))}
      {total > tickets.length && (
        <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
          Showing {tickets.length} of {total}.
        </Typography>
      )}
    </Stack>
  );
}
