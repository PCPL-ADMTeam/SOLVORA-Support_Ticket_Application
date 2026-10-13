import { Box, Stack, Typography } from "@mui/material";
import { format } from "date-fns";
import StickyNote2OutlinedIcon from "@mui/icons-material/StickyNote2Outlined";
import { CardFrame } from "./response/parts";

const at = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? format(d, "MMM d, yyyy, h:mm a") : null;
};

// The recorded reasons for a ticket (closed reason, resolution notes, on-hold reason, reopen note),
// newest first. Shown as text, never as HTML: it is ticket content.
export default function TicketReasonsCard({ reasons }) {
  if (!reasons?.length) return null;
  return (
    <CardFrame label="Recorded reasons" icon={StickyNote2OutlinedIcon} title="Recorded reasons" subtitle="As saved on the ticket, newest first">
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
        {reasons.map((r, i) => (
          <Box component="li" key={`${r.label}-${r.at}-${i}`} sx={{ minWidth: 0, p: 1.1, borderRadius: "10px", bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)", borderLeft: `4px solid ${r.current ? "var(--sv-accent-ink)" : "var(--sv-border)"}` }}>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="caption" sx={{ color: "var(--sv-text)", fontWeight: 800 }}>
                {r.label}
              </Typography>
              {r.current && (
                <Box component="span" sx={{ px: 0.75, borderRadius: 99, fontSize: 11, fontWeight: 700, color: "var(--sv-on-accent)", background: "var(--sv-accent-gradient)" }}>
                  Current
                </Box>
              )}
            </Stack>
            <Typography variant="body2" sx={{ mt: 0.25, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {r.text}
            </Typography>
            {(r.by || r.at) && (
              <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
                {[r.by, at(r.at)].filter(Boolean).join(" · ")}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </CardFrame>
  );
}
