import { Box, Paper, Typography } from "@mui/material";
import { format } from "date-fns";

// The recorded reasons for a ticket (closed reason, resolution notes, on-hold reason, reopen note),
// newest first. Shown as text, never as HTML: it is ticket content.
export default function TicketReasonsCard({ reasons }) {
  if (!reasons?.length) return null;
  return (
    <Paper variant="outlined" aria-label="Recorded reasons" sx={{ p: 1.5, mt: 1, bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)", borderRadius: "14px", color: "var(--sv-text)" }}>
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.25 }}>
        {reasons.map((r, i) => (
          <Box component="li" key={`${r.label}-${r.at}-${i}`} sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: "var(--sv-muted)", fontWeight: 700 }}>
              {r.label}
              {r.current ? " (current)" : ""}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {r.text}
            </Typography>
            {(r.by || r.at) && (
              <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
                {[r.by, r.at ? format(new Date(r.at), "MMM d, yyyy h:mm a") : null].filter(Boolean).join(" · ")}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
