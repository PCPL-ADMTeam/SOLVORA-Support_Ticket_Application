import { Box, Typography } from "@mui/material";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import BarChartOutlinedIcon from "@mui/icons-material/BarChartOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import HistoryIcon from "@mui/icons-material/History";
import SummarizeOutlinedIcon from "@mui/icons-material/SummarizeOutlined";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import { interactiveCard } from "./theme/chatStyles";

// Icon is chosen from the prompt wording only; the prompt text itself (which
// the server supplies) is what gets sent when a card is pressed.
const ICONS = [
  [/histor|timeline|activity/i, HistoryIcon],
  [/summar|report|statistic|trend|count|how many|by department/i, BarChartOutlinedIcon],
  [/team|people|employee|member|department|who /i, GroupsOutlinedIcon],
  [/rais|creat|add |new /i, AddCircleOutlineIcon],
  [/ticket/i, ConfirmationNumberOutlinedIcon],
  [/how|what|help|where/i, HelpOutlineIcon],
];
const iconFor = (prompt) => (ICONS.find(([re]) => re.test(prompt)) || [null, SummarizeOutlinedIcon])[1];

// Quick actions as a 2-column card grid (1 column on very narrow screens).
export default function SuggestedPrompts({ prompts, onSelect, disabled }) {
  if (!prompts?.length) return null;
  return (
    <Box role="group" aria-label="Suggested questions" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 1 }}>
      {prompts.map((p) => {
        const Icon = iconFor(p);
        return (
          <Box
            key={p}
            component="button"
            type="button"
            onClick={() => onSelect(p)}
            disabled={disabled}
            sx={{ ...interactiveCard, display: "flex", alignItems: "center", gap: 1.25, p: 1.25, minHeight: 56 }}
          >
            <Box aria-hidden sx={{ width: 34, height: 34, flexShrink: 0, borderRadius: "10px", display: "grid", placeItems: "center", bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)" }}>
              <Icon fontSize="small" />
            </Box>
            <Typography variant="body2" fontWeight={600} sx={{ color: "var(--sv-text)", lineHeight: 1.3 }}>
              {p}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
