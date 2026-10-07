import { Box, CircularProgress, Typography } from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import ExploreOutlinedIcon from "@mui/icons-material/ExploreOutlined";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import SuggestedPrompts from "./SuggestedPrompts";
import ChatErrorState from "./ChatErrorState";
import { card, rise, reducedMotion } from "./theme/chatStyles";

// What the assistant can really do, per role. Descriptive only; the server
// still decides what any request is allowed to return or change.
const CAPABILITIES = {
  base: [
    { icon: ManageSearchIcon, title: "Find tickets", text: "Look up tickets you can access by number, status or topic." },
    { icon: ConfirmationNumberOutlinedIcon, title: "Summaries", text: "Get a ticket's latest update and what is pending." },
    { icon: ExploreOutlinedIcon, title: "Guidance", text: "Ask how to use any page and jump straight to it." },
  ],
  ADMIN: { icon: AdminPanelSettingsOutlinedIcon, title: "Manage with approval", text: "Departments, users and tickets. You always confirm first." },
};

function Capabilities({ role }) {
  const items = [...CAPABILITIES.base, ...(role === "ADMIN" ? [CAPABILITIES.ADMIN] : [])];
  return (
    <Box component="ul" aria-label="What I can help with" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
      {items.map(({ icon: Icon, title, text }) => (
        <Box component="li" key={title} sx={{ display: "flex", gap: 1.25, alignItems: "flex-start", px: 0.5 }}>
          <Icon fontSize="small" aria-hidden sx={{ color: "var(--sv-accent-ink)", mt: "2px" }} />
          <Typography variant="body2" sx={{ color: "var(--sv-muted)" }}>
            <Box component="strong" sx={{ color: "var(--sv-text)", fontWeight: 600 }}>
              {title}
            </Box>
            {" · "}
            {text}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function SectionLabel({ children }) {
  return (
    <Typography variant="overline" component="h3" sx={{ display: "block", color: "var(--sv-muted)", fontWeight: 700, letterSpacing: "0.08em", lineHeight: 1.5, mb: 1 }}>
      {children}
    </Typography>
  );
}

// Empty state: hero + quick-action cards + capabilities, so a new chat never
// looks blank. All text comes from the server (welcome, suggestions); only the
// greeting name and role theme come from the signed-in profile.
export default function ChatWelcome({ intro, introError, onRetry, onSelect, disabled, firstName, role }) {
  if (introError && !intro) {
    return <ChatErrorState error={{ message: "I could not load the assistant. Please try again.", retryable: true }} onRetry={onRetry} />;
  }
  if (!intro) return <CircularProgress size={20} aria-label="Loading assistant" sx={{ color: "var(--sv-accent-ink)" }} />;

  return (
    <Box sx={{ display: "grid", gap: 2.5, animation: `${rise} var(--sv-slow) ease both`, ...reducedMotion }}>
      <Box sx={{ ...card, p: 2, background: "var(--sv-accent-soft)", borderColor: "transparent" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
          <AutoAwesomeIcon fontSize="small" aria-hidden sx={{ color: "var(--sv-accent-ink)" }} />
          <Typography variant="subtitle1" component="p" fontWeight={700} sx={{ color: "var(--sv-text)" }}>
            {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ color: "var(--sv-text)" }}>
          {intro.welcomeMessage}
        </Typography>
      </Box>

      <Box>
        <SectionLabel>Try asking</SectionLabel>
        <SuggestedPrompts prompts={intro.suggestions} onSelect={onSelect} disabled={disabled} />
      </Box>

      <Box>
        <SectionLabel>What I can do</SectionLabel>
        <Capabilities role={role} />
      </Box>
    </Box>
  );
}
