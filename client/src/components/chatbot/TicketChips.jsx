import { Box } from "@mui/material";

// The small status / priority pills used on the assistant's ticket cards.
// Color is a tint of one hex per status/priority so it reads in light and dark mode.
const STATUS = {
  OPEN: { label: "Open", color: "#C62828" },
  IN_PROGRESS: { label: "In Progress", color: "#D9622B" },
  ON_HOLD: { label: "On Hold", color: "#B7791F" },
  RESOLVED: { label: "Resolved", color: "#2E7D32" },
  CLOSED: { label: "Closed", color: "#6B7280" },
  REOPENED: { label: "Reopened", color: "#C2185B" },
};

const PRIORITY = {
  low: "#2E7D32",
  medium: "#B7791F",
  normal: "#B7791F",
  high: "#C62828",
  critical: "#C62828",
  urgent: "#C62828",
};

const pill = (color, outlined) => ({
  display: "inline-flex",
  alignItems: "center",
  px: 1,
  height: 22,
  borderRadius: 99,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: "nowrap",
  color,
  bgcolor: outlined ? "transparent" : `${color}1F`,
  border: `1px solid ${outlined ? color : `${color}33`}`,
});

// The accent colour of a status or priority, for tiles and bars (always next to a text label).
export const statusColor = (status) => STATUS[status]?.color || "#6B7280";
export const priorityColor = (name, fallback) => PRIORITY[String(name || "").toLowerCase()] || fallback || "#6B7280";

export function StatusChip({ status }) {
  const s = STATUS[status] || { label: String(status || ""), color: "#6B7280" };
  return <Box component="span" sx={pill(s.color, false)}>{s.label}</Box>;
}

export function PriorityChip({ name, color }) {
  if (!name) return null;
  const c = PRIORITY[String(name).toLowerCase()] || color || "#6B7280";
  // The most urgent priorities are outlined so they stand out from the filled ones.
  return (
    <Box component="span" sx={pill(c, /^(critical|urgent)$/i.test(name))}>
      {name}
    </Box>
  );
}
