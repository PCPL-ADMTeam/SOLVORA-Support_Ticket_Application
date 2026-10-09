import { useState } from "react";
import { Box, ClickAwayListener, IconButton, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import HistoryIcon from "@mui/icons-material/History";
import RefreshIcon from "@mui/icons-material/Refresh";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import RobotAvatar from "./RobotAvatar";
import { focusRing, reducedMotion } from "./theme/chatStyles";

const iconBtn = { color: "var(--sv-muted)", transition: "background-color var(--sv-fast) ease, color var(--sv-fast) ease", "&:hover": { bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)" }, ...focusRing, ...reducedMotion };

// "What I can do": what this role can really use, as sent by the server for the signed-in user.
function CapabilitiesPanel({ capabilities }) {
  return (
    <Box role="dialog" aria-label="What I can do" sx={{ p: 2, maxWidth: 320, color: "var(--sv-text)" }}>
      <Typography component="h3" variant="overline" sx={{ display: "block", fontWeight: 700, letterSpacing: "0.08em", color: "var(--sv-muted)", lineHeight: 1.6, mb: 1 }}>
        What I can do
      </Typography>
      {capabilities.map((section) => (
        <Box key={section.title} sx={{ mb: 1.25 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: "var(--sv-accent-ink)" }}>
            {section.title}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
            {section.items.map((item) => (
              <Typography key={item} component="li" variant="body2" sx={{ color: "var(--sv-text)" }}>
                {item}
              </Typography>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// Compact 72px header: avatar, title + portal, status, actions (info, history, reset, expand, close).
export default function ChatHeader({ portal, online, canReset, onReset, onClose, historyOpen, onToggleHistory, expanded, onToggleExpand, capabilities = [] }) {
  const [infoAnchor, setInfoAnchor] = useState(null);
  return (
    <Box component="header" sx={{ height: 72, flexShrink: 0, display: "flex", alignItems: "center", gap: 1.25, px: 2, bgcolor: "var(--sv-surface)", borderBottom: "1px solid var(--sv-border)", position: "relative" }}>
      {/* The only strong accent in the chrome: a thin role-colored top edge. */}
      <Box aria-hidden sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "var(--sv-accent-gradient)" }} />
      <RobotAvatar size={42} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography component="h2" variant="subtitle1" fontWeight={700} noWrap sx={{ color: "var(--sv-text)", lineHeight: 1.25 }}>
            Solvy
          </Typography>
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
      {capabilities.length > 0 && (
        <>
          <Tooltip title="What I can do">
            <IconButton size="small" onClick={(e) => setInfoAnchor((open) => (open ? null : e.currentTarget))} aria-label="What I can do" aria-haspopup="dialog" aria-expanded={Boolean(infoAnchor)} sx={{ ...iconBtn, ...(infoAnchor ? { bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)" } : {}) }}>
              <InfoOutlinedIcon />
            </IconButton>
          </Tooltip>
          {infoAnchor && (
            <ClickAwayListener onClickAway={(e) => !e.target.closest?.('[aria-haspopup="dialog"]') && setInfoAnchor(null)}>
              <Box
                onKeyDown={(e) => e.key === "Escape" && setInfoAnchor(null)}
                sx={{ position: "absolute", top: "calc(100% + 6px)", right: 12, zIndex: 5, maxHeight: "60vh", overflowY: "auto", bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)", borderRadius: "14px", boxShadow: "var(--sv-shadow)" }}
              >
                <CapabilitiesPanel capabilities={capabilities} />
              </Box>
            </ClickAwayListener>
          )}
        </>
      )}
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
