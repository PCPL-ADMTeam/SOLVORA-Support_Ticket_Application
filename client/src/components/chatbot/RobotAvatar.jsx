import { Box } from "@mui/material";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";

// The Solvora assistant's picture: client/src/assets/chatbot/solvora-robot.png (.webp, .jpg, .jpeg or
// .svg also work). It is used in the header, the welcome screen, the replies and the launcher button.
// If the file is removed, the icon below is shown instead, so nothing breaks. Vite bundles whichever
// file exists at build time.
const found = import.meta.glob("../../assets/chatbot/solvora-robot.{png,webp,jpg,jpeg,svg}", { eager: true, import: "default" });
const ROBOT_SRC = Object.values(found)[0] || null;

export const hasRobotImage = Boolean(ROBOT_SRC);

// The picture is a robot on a dark-blue background, so it is shown as a round badge
// (never stretched). `ring` adds a thin light border where it sits on a dark or red surface.
export default function RobotAvatar({ size = 40, ring = false, sx }) {
  if (!ROBOT_SRC) {
    return (
      <Box aria-hidden sx={{ width: size, height: size, flexShrink: 0, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)", ...sx }}>
        <SmartToyOutlinedIcon sx={{ fontSize: size * 0.58 }} />
      </Box>
    );
  }
  return (
    <Box
      aria-hidden
      sx={{ width: size, height: size, flexShrink: 0, borderRadius: "50%", overflow: "hidden", bgcolor: "#0A1E4A", border: ring ? "2px solid rgba(255,255,255,0.9)" : "1px solid var(--sv-border)", boxShadow: "0 1px 4px rgba(10,30,74,0.25)", ...sx }}
    >
      <Box component="img" src={ROBOT_SRC} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 32%", display: "block" }} />
    </Box>
  );
}
