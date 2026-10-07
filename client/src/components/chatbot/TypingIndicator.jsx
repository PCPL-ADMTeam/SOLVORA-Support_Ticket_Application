import { Box, Typography } from "@mui/material";
import { card, dot, reducedMotion } from "./theme/chatStyles";

export default function TypingIndicator() {
  return (
    <Box role="status" sx={{ ...card, alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderRadius: "var(--sv-radius-bubble)", borderBottomLeftRadius: 4 }}>
      <Box aria-hidden sx={{ display: "inline-flex", gap: "4px" }}>
        {[0, 1, 2].map((i) => (
          <Box key={i} component="span" sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "var(--sv-accent-ink)", animation: `${dot} 1.2s ease-in-out ${i * 0.15}s infinite`, ...reducedMotion }} />
        ))}
      </Box>
      <Typography variant="body2" sx={{ color: "var(--sv-muted)" }}>
        Thinking…
      </Typography>
    </Box>
  );
}
