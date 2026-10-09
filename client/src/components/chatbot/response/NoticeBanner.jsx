import { Box, Typography } from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

// A small label above an answer that is a refusal or a "could not", so it reads differently from data.
// It names the kind of answer only; the explanation itself is the message text (never ids or internals).
const KINDS = {
  CHAT_ACCESS_DENIED: { icon: LockOutlinedIcon, label: "Not available for your role", color: "var(--sv-warning)" },
  CHAT_TICKET_NOT_FOUND: { icon: LockOutlinedIcon, label: "No access or not found", color: "var(--sv-warning)" },
  CHAT_NO_RESULTS: { icon: SearchOffIcon, label: "No results", color: "var(--sv-muted)" },
  CHAT_UNSUPPORTED_INTENT: { icon: HelpOutlineIcon, label: "Not understood", color: "var(--sv-muted)" },
};

export function noticeKind(error) {
  if (!error?.code) return null;
  return KINDS[error.code] || (error.code.startsWith("CHAT_") ? { icon: ErrorOutlineIcon, label: "Couldn't complete that", color: "var(--sv-error)" } : null);
}

export default function NoticeBanner({ error }) {
  const kind = noticeKind(error);
  if (!kind) return null;
  const Icon = kind.icon;
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, mb: 0.5, px: 0.9, py: 0.2, borderRadius: 99, border: `1px solid ${kind.color}`, color: kind.color }}>
      <Icon aria-hidden sx={{ fontSize: 14 }} />
      <Typography component="span" variant="caption" fontWeight={700} sx={{ color: "inherit" }}>
        {kind.label}
      </Typography>
    </Box>
  );
}
