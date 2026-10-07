import { Box, Paper, Typography } from "@mui/material";
import { statusColors } from "../../theme/theme";

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

export default function StatisticsCard({ statistics }) {
  if (!statistics) return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mt: 1, bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)", borderRadius: "14px", color: "var(--sv-text)" }} aria-label="Ticket statistics">
      <Typography variant="subtitle2" fontWeight={700}>
        {statistics.label}: {statistics.total} tickets
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 1, mt: 1 }}>
        {Object.entries(statistics.byStatus).map(([status, count]) => (
          <Kpi key={status} label={STATUS_LABELS[status] || status} value={count} color={statusColors[status]?.color} />
        ))}
      </Box>
      {statistics.byPriority?.length > 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 1, mt: 1 }}>
          {statistics.byPriority.map((p) => (
            <Kpi key={p.priority} label={`${p.priority} priority`} value={p.count} />
          ))}
        </Box>
      )}
      <Typography variant="caption" display="block" sx={{ mt: 1, color: "var(--sv-muted)" }}>
        Created in last 7 days: {statistics.createdLast7Days} (previous 7: {statistics.createdPrevious7Days}) · last 30 days: {statistics.createdLast30Days}
      </Typography>
    </Paper>
  );
}
