import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Paper, Typography, Box } from "@mui/material";
import { statusColors } from "../../theme/theme";

// Tickets-by-status donut. Uses the fixed workflow-stage -> categorical-slot
// mapping from theme.js so colors always agree with StatusBadge chips.
// `selectedStatus` (optional) is the dashboard's own active cross-filter —
// purely a visual affordance here (a thicker stroke on the selected slice,
// dimmed opacity on the rest); it never changes what data this chart
// receives, only how it's drawn. No new color system — every slice still
// uses its existing theme.js color.
export default function StatusPieChart({ data, onSliceClick, selectedStatus }) {
  const chartData = data.filter((d) => d.count > 0);

  return (
    <Paper variant="outlined" sx={{ p: 2, height: 340 }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>Tickets by Status</Typography>
      {chartData.length === 0 ? (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: 260, color: "text.secondary" }}>
          No data for this range
        </Box>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="count"
              nameKey="status"
              innerRadius={60}
              outerRadius={95}
              paddingAngle={2}
              cornerRadius={4}
              onClick={(entry) => onSliceClick?.(entry.status)}
              cursor={onSliceClick ? "pointer" : "default"}
              // A quick, subtle re-draw when the underlying counts change
              // (e.g. after a cross-filter click) rather than recharts'
              // slower ~1500ms default — the slices themselves are never
              // unmounted/recreated for a data change, only re-drawn.
              isAnimationActive
              animationDuration={300}
              animationEasing="ease-out"
            >
              {chartData.map((entry) => {
                const isSelected = selectedStatus === entry.status;
                const isDimmed = Boolean(selectedStatus) && !isSelected;
                return (
                  <Cell
                    key={entry.status}
                    fill={statusColors[entry.status]?.color || "#898781"}
                    stroke="var(--mui-palette-background-paper, #fff)"
                    strokeWidth={isSelected ? 3 : 2}
                    opacity={isDimmed ? 0.35 : 1}
                  />
                );
              })}
            </Pie>
            <Tooltip formatter={(value, _name, item) => [value, item.payload.status]} />
            <Legend verticalAlign="bottom" height={36} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </Paper>
  );
}
