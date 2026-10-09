import { Box, Typography } from "@mui/material";
import { CardFrame, CardTitle, PeriodBadge, StatTile, TileGrid } from "./parts";
import { priorityColor, statusColor } from "../TicketChips";

// Dashboard numbers for the user's own scope (from the dashboard service): tickets by priority, by status,
// or workload per employee / per department. The scope and the period are always named on the card.
export default function OverviewCard({ overview }) {
  if (!overview) return null;
  const { kind, title, scope, period, total, rows = [], columns = [], note } = overview;
  return (
    <CardFrame label={title}>
      <CardTitle badge={<PeriodBadge period={period} />}>{title}</CardTitle>
      <Typography variant="caption" display="block" sx={{ mt: -0.5, mb: 1, color: "var(--sv-muted)" }}>
        {scope}
        {typeof total === "number" ? ` · ${total} ticket${total === 1 ? "" : "s"} in total` : ""}
      </Typography>

      {(kind === "priority" || kind === "status") && (
        <TileGrid label={title}>
          {rows.map((r) => (
            <StatTile key={r.label} label={r.label} value={r.count} color={kind === "status" ? statusColor(r.status) : priorityColor(r.label)} muted={r.count === 0} />
          ))}
        </TileGrid>
      )}

      {kind === "workload" && (
        <Box component="ul" aria-label={title} sx={{ m: 0, p: 0, display: "grid", gap: 0.75 }}>
          {rows.map((r) => (
            <Box component="li" key={r.label} sx={{ listStyle: "none", p: 1, borderRadius: "10px", bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)" }}>
              <Typography variant="body2" fontWeight={700} sx={{ wordBreak: "break-word" }}>
                {r.label}
              </Typography>
              <Box component="dl" sx={{ m: 0, mt: 0.5, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(92px, 100%), 1fr))", gap: 0.5 }}>
                {columns.map((c, i) => (
                  <Box key={c} sx={{ display: "flex", alignItems: "baseline", gap: 0.5, minWidth: 0 }}>
                    <Typography component="dt" variant="caption" sx={{ color: "var(--sv-muted)" }}>
                      {c}
                    </Typography>
                    <Typography component="dd" variant="body2" fontWeight={800} sx={{ m: 0, fontVariantNumeric: "tabular-nums" }}>
                      {r.values[i]}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {note && (
        <Typography variant="caption" display="block" sx={{ mt: 0.75, color: "var(--sv-muted)" }}>
          {note}
        </Typography>
      )}
    </CardFrame>
  );
}
