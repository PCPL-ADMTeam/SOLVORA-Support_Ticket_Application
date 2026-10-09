import { Box, Paper, Typography } from "@mui/material";
import { statusColors } from "../../theme/theme";
import { PeriodBadge } from "./response/parts";

const STATUS_LABELS = { OPEN: "Open", IN_PROGRESS: "In Progress", ON_HOLD: "On Hold", RESOLVED: "Resolved", CLOSED: "Closed", REOPENED: "Reopened" };

// A single KPI tile: big number, small label. The status color is a thin accent
// bar plus the label text, never the only carrier of meaning.
function Kpi({ label, value, color }) {
  return (
    <Box sx={{ bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)", borderRadius: "12px", p: 1.25, borderLeft: `4px solid ${color || "var(--sv-accent-ink)"}`, minWidth: 0 }}>
      <Typography component="div" sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1, color: "var(--sv-text)" }}>
        {value}
      </Typography>
      <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
        {label}
      </Typography>
    </Box>
  );
}

// A label and its number on one line, for the activity figures under the tiles.
function Line({ label, value }) {
  return (
    <Box component="li" sx={{ listStyle: "none", display: "flex", gap: 1, py: 0.25 }}>
      <Typography variant="caption" sx={{ flex: 1, color: "var(--sv-muted)" }}>
        {label}
      </Typography>
      <Typography variant="caption" fontWeight={800} sx={{ color: "var(--sv-text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
    </Box>
  );
}

export default function StatisticsCard({ statistics }) {
  if (!statistics) return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mt: 1, bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)", borderRadius: "14px", color: "var(--sv-text)" }} aria-label="Ticket statistics">
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 0.75 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          {statistics.label}: {statistics.total} tickets
        </Typography>
        {/* The status counts cover every ticket in scope, whatever its age. */}
        <PeriodBadge period="All time" />
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(104px, 100%), 1fr))", gap: 1, mt: 1 }}>
        {Object.entries(statistics.byStatus).map(([status, count]) => (
          <Kpi key={status} label={STATUS_LABELS[status] || status} value={count} color={statusColors[status]?.color} />
        ))}
      </Box>
      {statistics.byPriority?.length > 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(104px, 100%), 1fr))", gap: 1, mt: 1 }}>
          {statistics.byPriority.map((p) => (
            <Kpi key={p.priority} label={`${p.priority} priority`} value={p.count} />
          ))}
        </Box>
      )}
      <Box component="ul" aria-label="Recent activity" sx={{ m: 0, mt: 1, p: 0 }}>
        {typeof statistics.openUnassigned === "number" && <Line label="Open with no assignee" value={statistics.openUnassigned} />}
        {typeof statistics.openInactiveOver7Days === "number" && <Line label="Open with no update for over 7 days" value={statistics.openInactiveOver7Days} />}
        <Line label="Created in the last 7 days" value={statistics.createdLast7Days} />
        <Line label="Created in the 7 days before that" value={statistics.createdPrevious7Days} />
        <Line label="Created in the last 30 days" value={statistics.createdLast30Days} />
      </Box>
    </Paper>
  );
}
