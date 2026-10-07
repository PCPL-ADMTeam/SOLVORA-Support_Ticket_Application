import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import HistoryIcon from "@mui/icons-material/History";
import RefreshIcon from "@mui/icons-material/Refresh";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import { ROLE_LABELS } from "./theme/chatTokens";
import { focusRing, reducedMotion } from "./theme/chatStyles";

const iconBtn = { color: "var(--sv-muted)", transition: "background-color var(--sv-fast) ease, color var(--sv-fast) ease", "&:hover": { bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)" }, ...focusRing, ...reducedMotion };

// Compact 72px header: avatar, title + portal, role badge, status, actions.
export default function ChatHeader({ portal, role, online, canReset, onReset, onClose, historyOpen, onToggleHistory, expanded, onToggleExpand }) {
  return (
    <Box component="header" sx={{ height: 72, flexShrink: 0, display: "flex", alignItems: "center", gap: 1.25, px: 2, bgcolor: "var(--sv-surface)", borderBottom: "1px solid var(--sv-border)", position: "relative" }}>
      {/* The only strong accent in the chrome: a thin role-colored top edge. */}
      <Box aria-hidden sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "var(--sv-accent-gradient)" }} />
      <Box aria-hidden sx={{ width: 40, height: 40, flexShrink: 0, borderRadius: "12px", display: "grid", placeItems: "center", background: "var(--sv-accent-gradient)", color: "var(--sv-on-accent)" }}>
        <SmartToyOutlinedIcon />
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography component="h2" variant="subtitle1" fontWeight={700} noWrap sx={{ color: "var(--sv-text)", lineHeight: 1.25 }}>
            Solvora Assistant
          </Typography>
          {ROLE_LABELS[role] && (
            <Box component="span" sx={{ px: 0.9, py: "1px", borderRadius: 99, fontSize: 11, fontWeight: 700, bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)", flexShrink: 0 }}>
              {ROLE_LABELS[role]}
            </Box>
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
          {portal && (
            <Typography variant="caption" noWrap sx={{ color: "var(--sv-muted)" }}>
              {portal}
            </Typography>
          )}
          <Box component="span" aria-hidden sx={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, bgcolor: online ? "var(--sv-success)" : "var(--sv-muted)" }} />
          <Typography variant="caption" sx={{ color: "var(--sv-muted)", flexShrink: 0 }}>
            {online ? "Online" : "Offline"}
          </Typography>
        </Box>
      </Box>
      <Tooltip title={historyOpen ? "Back to chat" : "Chat history"}>
        <IconButton size="small" onClick={onToggleHistory} aria-label="Chat history" aria-pressed={historyOpen} sx={{ ...iconBtn, ...(historyOpen ? { bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)" } : {}) }}>
          <HistoryIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title="Start a new conversation">
        <span>
          <IconButton size="small" onClick={onReset} aria-label="Reset conversation" disabled={!canReset} sx={iconBtn}>
            <RefreshIcon />
          </IconButton>
        </span>
      </Tooltip>
      {onToggleExpand && (
        <Tooltip title={expanded ? "Restore size" : "Expand to the edge"}>
          <IconButton size="small" onClick={onToggleExpand} aria-label={expanded ? "Restore assistant size" : "Expand assistant"} sx={{ ...iconBtn, display: { xs: "none", sm: "inline-flex" } }}>
            {expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Close">
        <IconButton size="small" onClick={onClose} aria-label="Close assistant" sx={iconBtn}>
          <CloseIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
