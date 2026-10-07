import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { Badge, Fab, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ChatPanel from "./ChatPanel";
import { useChatbot } from "../../hooks/useChatbot";
import { LAUNCHER_GRADIENT, chatThemeVars } from "./theme/chatTokens";
import { bounce, glow, reducedMotion } from "./theme/chatStyles";

const PANEL_ID = "solvora-chat-panel";

// Floating chat button + expandable panel. Mounted once in AppShell, which all
// four portal layouts (Admin, Manager/Team Lead via AgentLayout, Employee)
// render — so the widget is the same everywhere and its role-specific content
// (welcome text, suggested prompts, answers) is whatever the SERVER returns for
// the authenticated user. The widget never selects or sends a role.
//
// `role` and `firstName` only drive the color theme and greeting (cosmetic);
// they are never sent to the server.
//
// onOpenDialog(name): lets the assistant open existing AppShell dialogs
// ("profile" | "edit-profile") because profile/password have no route.
export default function ChatWidget({ onOpenDialog, role, firstName }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [unread, setUnread] = useState(0);
  const [bouncing, setBouncing] = useState(false);
  const fabRef = useRef(null);
  const wasOpen = useRef(false);
  const seen = useRef(0);
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  // On a ticket page ("/tickets/<id>", "/tickets/<id>/edit") "this ticket" means that ticket.
  const { pathname } = useLocation();
  const pageTicketId = (matchPath("/tickets/:id/*", pathname) || matchPath("/tickets/:id", pathname))?.params.id || null;
  const chat = useChatbot({ pageTicketId });
  const vars = useMemo(() => chatThemeVars(theme.palette.mode, role), [theme.palette.mode, role]);

  const close = useCallback(() => setOpen(false), []);

  // Focus management: return focus to the launcher when the panel closes.
  useEffect(() => {
    if (wasOpen.current && !open) fabRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Replies that arrive while the panel is closed show as an unread badge.
  const assistantCount = chat.messages.filter((m) => m.role === "assistant").length;
  useEffect(() => {
    if (open) {
      seen.current = assistantCount;
      setUnread(0);
    } else if (assistantCount > seen.current) {
      setUnread(assistantCount - seen.current);
      setBouncing(true);
      const t = setTimeout(() => setBouncing(false), 1200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [assistantCount, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const handleNavigate = useCallback(
    (target) => {
      if (!target) return;
      if (target.type === "route") navigate(target.path);
      else if (target.type === "dialog") onOpenDialog?.(target.dialog);
      // The full-screen mobile panel would hide the destination.
      if (isMobile) close();
    },
    [navigate, onOpenDialog, isMobile, close]
  );

  return (
    // display: contents keeps the wrapper out of layout while the CSS variables
    // (the design tokens) still cascade to the panel and launcher.
    <div style={{ display: "contents", ...vars }}>
      {open && <ChatPanel chat={chat} panelId={PANEL_ID} onClose={close} onNavigate={handleNavigate} role={role} firstName={firstName} expanded={expanded} onToggleExpand={() => setExpanded((v) => !v)} />}
      {/* On mobile the open panel is full screen, so the launcher is hidden behind it. */}
      {!(open && (isMobile || expanded)) && (
        <Badge
          badgeContent={unread}
          invisible={!unread || open}
          max={9}
          overlap="circular"
          sx={{ position: "fixed", right: 24, bottom: 24, zIndex: (t) => t.zIndex.modal - 1, "& .MuiBadge-badge": { bgcolor: "#111827", color: "#fff", border: "2px solid #fff", fontWeight: 700 } }}
        >
          <Fab
            ref={fabRef}
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close assistant chat" : "Open assistant chat"}
            aria-expanded={open}
            aria-controls={open ? PANEL_ID : undefined}
            aria-haspopup="dialog"
            sx={{
              width: 64,
              height: 64,
              color: "#fff",
              background: LAUNCHER_GRADIENT,
              boxShadow: "0 8px 24px rgba(198,40,40,0.38)",
              transition: "transform 150ms ease, box-shadow 150ms ease",
              animation: bouncing ? `${bounce} 900ms ease 1` : open ? "none" : `${glow} 3.2s ease-in-out infinite`,
              "&:hover": { background: LAUNCHER_GRADIENT, transform: "scale(1.06)" },
              "&:focus-visible": { outline: "3px solid #111827", outlineOffset: 3 },
              ...reducedMotion,
            }}
          >
            {open ? <CloseIcon fontSize="large" /> : <AutoAwesomeIcon fontSize="large" />}
          </Fab>
        </Badge>
      )}
    </div>
  );
}
