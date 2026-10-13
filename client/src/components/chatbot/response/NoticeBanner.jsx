import { Typography } from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { Callout } from "./parts";

// An answer that is a refusal, a "nothing found" or a "not understood" is shown inside a tinted callout
// with a label naming the kind of answer, so it reads differently from data. The explanation itself is the
// message text (never ids or internals).
const KINDS = {
  CHAT_ACCESS_DENIED: { icon: LockOutlinedIcon, label: "Not available for your role", tone: "blocked" },
  CHAT_TICKET_NOT_FOUND: { icon: LockOutlinedIcon, label: "No access or not found", tone: "blocked" },
  CHAT_NO_RESULTS: { icon: SearchOffIcon, label: "No results", tone: "info" },
  CHAT_UNSUPPORTED_INTENT: { icon: HelpOutlineIcon, label: "Not understood", tone: "info" },
};

export function noticeKind(error) {
  if (!error?.code) return null;
  return KINDS[error.code] || (error.code.startsWith("CHAT_") ? { icon: ErrorOutlineIcon, label: "Couldn't complete that", tone: "error" } : null);
}

export default function NoticeCallout({ error, children }) {
  const kind = noticeKind(error);
  if (!kind) return children;
  return (
    <Callout tone={kind.tone} icon={kind.icon} label={kind.label}>
      <Typography variant="caption" fontWeight={800} sx={{ display: "block", mb: 0.25, color: "var(--sv-muted)" }}>
        {kind.label}
      </Typography>
      {children}
    </Callout>
  );
}
