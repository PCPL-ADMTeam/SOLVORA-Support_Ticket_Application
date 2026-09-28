import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { Paper, Typography } from "@mui/material";

// Tickets-by-priority bar chart. Priority colors come from the server (the
// same good/warning/serious/critical severity steps used elsewhere), so this
// chart automatically matches the priority badges used elsewhere. This is
// the final drill-down step of the dashboard's BI-style cross-filtering —
// `onBarClick` receives the FULL data entry (not just the display name), so
// a caller can read `entry.id` (the Priority's real database id, needed for
// the Tickets List's `?priorityId=` filter) alongside `entry.priority`
// (display name) and `entry.count`.
export default function PriorityBarChart({ data, onBarClick }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: 340 }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>Tickets by Priority</Typography>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" vertical={false} />
          <XAxis dataKey="priority" tick={{ fontSize: 12 }} stroke="#898781" />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#898781" />
          <Tooltip />
          <Bar
            dataKey="count"
            radius={[4, 4, 0, 0]}
            maxBarSize={56}
            cursor={onBarClick ? "pointer" : "default"}
            onClick={(entry) => onBarClick?.(entry)}
            // Bars animate height from their old value to the new one on a
            // cross-filter update (a quick, subtle re-draw, matching
            // StatusPieChart's own timing) rather than the chart
            // disappearing and reappearing — recharts' default ~1500ms felt
            // sluggish for this interaction.
            isAnimationActive
            animationDuration={300}
            animationEasing="ease-out"
          >
            {data.map((entry) => (
              <Cell key={entry.priority} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Paper>
  );
}
