import { Paper, Typography, Box } from "@mui/material";
import { alpha } from "@mui/material/styles";

export default function KpiCard({ label, value, color = "#c81e2a", icon, onClick }) {
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 1.5,
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        cursor: onClick ? "pointer" : "default",
        borderRadius: 3,
        transition: "transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease",
        "&:hover": onClick ? { transform: "translateY(-3px)", boxShadow: "0 10px 24px rgba(102, 23, 31, 0.12)", borderColor: alpha(color, 0.35) } : undefined,
      }}
    >
      {/* Icon slot always reserves the same 44x44 width — even for cards
          with no icon (e.g. "Closed") — so the value/label text lines up
          identically across every card in the row instead of shifting left
          on cards that happen not to have one. */}
      <Box
        sx={{
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: icon ? alpha(color, 0.14) : "transparent",
          color,
        }}
      >
        {icon}
      </Box>
      <Box>
        {/* `key={value}` retriggers the fade-in keyframe whenever the KPI's
            number itself changes (e.g. a dashboard cross-filter click) —
            this only remounts the small text node below, never the KpiCard/
            Paper itself, so the card never flashes or shifts layout; it
            just gives the new number a brief, subtle entrance instead of
            silently snapping to the new value. */}
        <Typography
          key={value}
          variant="h6"
          sx={{
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.2,
            animation: "kpi-value-fade 300ms ease-out",
            "@keyframes kpi-value-fade": {
              from: { opacity: 0.4 },
              to: { opacity: 1 },
            },
          }}
        >
          {value}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.25, display: "block" }}>
          {label}
        </Typography>
      </Box>
    </Paper>
  );
}
