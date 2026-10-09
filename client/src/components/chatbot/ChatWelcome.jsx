import { Badge, Box, CircularProgress, Typography } from "@mui/material";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import HistoryToggleOffIcon from "@mui/icons-material/HistoryToggleOff";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import PersonOffOutlinedIcon from "@mui/icons-material/PersonOffOutlined";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import BarChartOutlinedIcon from "@mui/icons-material/BarChartOutlined";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import ApartmentOutlinedIcon from "@mui/icons-material/ApartmentOutlined";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import RobotAvatar from "./RobotAvatar";
import ChatErrorState from "./ChatErrorState";
import { focusRing, interactiveCard, rise, reducedMotion } from "./theme/chatStyles";

const ICONS = {
  tickets: ConfirmationNumberOutlinedIcon,
  open: HistoryToggleOffIcon,
  raise: AddCircleOutlineIcon,
  notifications: NotificationsNoneIcon,
  department: GroupsOutlinedIcon,
  unassigned: PersonOffOutlinedIcon,
  assigned: AssignmentIndOutlinedIcon,
  summary: BarChartOutlinedIcon,
  workload: PeopleAltOutlinedIcon,
  users: PeopleAltOutlinedIcon,
  departments: ApartmentOutlinedIcon,
  trends: TrendingUpIcon,
};

// Empty state: the greeting and the role's own quick actions, so a new chat never looks blank.
// The quick actions, the greeting line and the badge count all come from the server for the signed-in
// role (the browser never decides what a role is offered); each one is sent as an ordinary question.
export default function ChatWelcome({ intro, introError, onRetry, onSelect, disabled, firstName }) {
  if (introError && !intro) {
    return <ChatErrorState error={{ message: "I could not load the assistant. Please try again.", retryable: true }} onRetry={onRetry} />;
  }
  if (!intro) return <CircularProgress size={20} aria-label="Loading assistant" sx={{ color: "var(--sv-accent-ink)" }} />;

  const actions = intro.quickActions || [];
  const unread = intro.unreadNotifications || 0;
  return (
    <Box sx={{ display: "grid", gap: 2.5, justifyItems: "center", textAlign: "center", pt: 2, animation: `${rise} var(--sv-slow) ease both`, ...reducedMotion }}>
      <Box>
        <Box sx={{ display: "grid", placeItems: "center", mb: 1.5 }}>
          <RobotAvatar size={96} sx={{ boxShadow: "0 6px 20px rgba(10,30,74,0.28)" }} />
        </Box>
        <Typography component="p" sx={{ fontSize: 24, fontWeight: 700, color: "var(--sv-text)", lineHeight: 1.2 }}>
          Welcome back,
        </Typography>
        <Typography component="p" sx={{ fontSize: 24, fontWeight: 700, color: "var(--sv-accent-ink)", lineHeight: 1.25 }}>
          {firstName || "there"}{" "}
          <span role="img" aria-label="waving hand">
            👋
          </span>
        </Typography>
        <Typography sx={{ mt: 1.5, fontSize: 16, color: "var(--sv-text)" }}>{intro.welcomeSubtitle || "How can I help you today?"}</Typography>
        {intro.whatsNew && (
          <Box
            component="button"
            type="button"
            onClick={() => onSelect(intro.whatsNew.prompt)}
            disabled={disabled}
            sx={{
              mt: 1.75,
              mx: "auto",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 0.75,
              font: "inherit",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              px: 2,
              py: 0.9,
              borderRadius: 99,
              color: "var(--sv-accent-ink)",
              bgcolor: "var(--sv-accent-soft)",
              border: "1px solid var(--sv-accent-ink)",
              transition: "transform var(--sv-fast) ease, box-shadow var(--sv-fast) ease",
              "&:hover:not(:disabled)": { transform: "translateY(-1px)", boxShadow: "var(--sv-card-shadow-hover)" },
              "&:disabled": { opacity: 0.55, cursor: "default" },
              ...focusRing,
              ...reducedMotion,
            }}
          >
            <AutoAwesomeIcon sx={{ fontSize: 17 }} />
            {intro.whatsNew.label}
          </Box>
        )}
      </Box>

      {actions.length > 0 && (
        <Box role="group" aria-label="Quick actions" sx={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.25, textAlign: "left" }}>
          {actions.map(({ label, prompt, icon }) => {
            const Icon = ICONS[icon] || ConfirmationNumberOutlinedIcon;
            const badge = icon === "notifications" ? unread : 0;
            return (
              <Box
                key={label}
                component="button"
                type="button"
                aria-label={label}
                onClick={() => onSelect(prompt)}
                disabled={disabled}
                sx={{ ...interactiveCard, display: "flex", alignItems: "center", gap: 1.25, p: 1.5, minHeight: 64, borderRadius: "14px" }}
              >
                <Box aria-hidden sx={{ width: 36, height: 36, flexShrink: 0, borderRadius: "10px", display: "grid", placeItems: "center", bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)" }}>
                  <Icon fontSize="small" />
                </Box>
                <Typography variant="body2" fontWeight={600} sx={{ flex: 1, color: "var(--sv-text)", lineHeight: 1.25 }}>
                  {label}
                </Typography>
                {badge > 0 && <Badge badgeContent={badge} max={99} color="error" sx={{ mr: 1.25 }} aria-label={`${badge} unread`} />}
                <ChevronRightIcon aria-hidden sx={{ color: "var(--sv-muted)", fontSize: 20 }} />
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
