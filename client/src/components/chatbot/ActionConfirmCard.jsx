import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { focusRing, reducedMotion } from "./theme/chatStyles";

const DONE = {
  EXECUTED: { label: "Done", color: "success" },
  CANCELLED: { label: "Cancelled", color: "default" },
  EXPIRED: { label: "Expired", color: "warning" },
  FAILED: { label: "Not done", color: "error" },
  HISTORY: { label: "From an earlier chat", color: "default" },
  SUPERSEDED: { label: "Being changed", color: "default" },
  CONFIRMING: { label: "In progress", color: "info" },
};

// Preview of a change the assistant has PREPARED but not made. Nothing happens
// until the admin presses Confirm, which calls the authenticated confirm
// endpoint; the outcome shown afterwards is whatever the server reports.
export default function ActionConfirmCard({ action, state, onConfirm, onCancel, onEdit }) {
  const status = state?.status && state.status !== "PENDING" ? state.status : null;
  const busy = Boolean(state?.busy);
  const outcome = status ? DONE[status] : null;

  return (
    <Paper
      variant="outlined"
      role="group"
      aria-label={`Proposed change: ${action.title}`}
      sx={{ p: 1.5, mt: 1, bgcolor: "var(--sv-bg)", color: "var(--sv-text)", borderRadius: "14px", border: "1px solid var(--sv-border)", borderLeft: "4px solid var(--sv-warning)" }}
    >
      <Typography variant="caption" display="block" sx={{ color: "var(--sv-muted)", fontWeight: 600 }}>
        {action.title === "Raise ticket" ? "Ticket not raised yet" : "Proposed change · not made yet"}
      </Typography>
      <Typography variant="subtitle2" fontWeight={700} sx={{ wordBreak: "break-word" }}>
        {action.summary}
      </Typography>
      {action.impact?.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {action.impact.map((i) => (
            <li key={i}>
              <Typography variant="body2" sx={{ color: "var(--sv-text)" }}>
                {i}
              </Typography>
            </li>
          ))}
        </Box>
      )}

      {outcome ? (
        <Chip size="small" label={outcome.label} color={outcome.color} sx={{ mt: 1 }} role="status" />
      ) : (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <Button
            variant="contained"
            size="small"
            disableElevation
            disabled={busy}
            onClick={() => onConfirm(action)}
            aria-label={`Confirm: ${action.summary}`}
            sx={{ background: "var(--sv-accent-gradient)", color: "var(--sv-on-accent)", borderRadius: "10px", ...focusRing, ...reducedMotion }}
          >
            {action.title === "Raise ticket" ? "Raise Ticket" : "Confirm"}
          </Button>
          <Button
            variant="outlined"
            size="small"
            disabled={busy}
            onClick={() => onCancel(action)}
            aria-label="Cancel this change"
            sx={{ color: "var(--sv-text)", borderColor: "var(--sv-border)", borderRadius: "10px", ...focusRing }}
          >
            Cancel
          </Button>
          {onEdit && (
            <Button
              variant="text"
              size="small"
              disabled={busy}
              onClick={() => onEdit(action)}
              aria-label="Edit this request"
              sx={{ color: "var(--sv-accent-ink)", borderRadius: "10px", ...focusRing }}
            >
              Edit
            </Button>
          )}
        </Stack>
      )}
    </Paper>
  );
}
