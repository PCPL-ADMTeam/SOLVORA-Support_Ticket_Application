import { useState } from "react";
import { IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import ThumbUpOutlinedIcon from "@mui/icons-material/ThumbUpOutlined";
import ThumbDownOutlinedIcon from "@mui/icons-material/ThumbDownOutlined";
import FlagOutlinedIcon from "@mui/icons-material/FlagOutlined";
import { focusRing } from "./theme/chatStyles";

const REPORTS = [
  { rating: "incorrect", label: "Incorrect information" },
  { rating: "unauthorized_information", label: "Shows information I should not see" },
  { rating: "other", label: "Other problem" },
];

const btn = { color: "var(--sv-muted)", "&:hover": { color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)" }, ...focusRing };
const icon = { fontSize: 18 };

export default function ChatFeedback({ messageId, onSubmit }) {
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const [anchor, setAnchor] = useState(null);

  const submit = async (rating) => {
    setAnchor(null);
    setFailed(false);
    try {
      await onSubmit(messageId, rating);
      setSent(true);
    } catch {
      setFailed(true);
    }
  };

  if (sent) {
    return (
      <Typography variant="caption" role="status" sx={{ color: "var(--sv-muted)", ml: 0.5 }}>
        Thanks for the feedback.
      </Typography>
    );
  }

  return (
    <Stack direction="row" alignItems="center" spacing={0.25}>
      <Tooltip title="Helpful">
        <IconButton size="small" aria-label="Mark response as helpful" onClick={() => submit("helpful")} sx={btn}>
          <ThumbUpOutlinedIcon sx={icon} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Not helpful">
        <IconButton size="small" aria-label="Mark response as not helpful" onClick={() => submit("not_helpful")} sx={btn}>
          <ThumbDownOutlinedIcon sx={icon} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Report a problem">
        <IconButton size="small" aria-label="Report a problem with this response" aria-haspopup="menu" onClick={(e) => setAnchor(e.currentTarget)} sx={btn}>
          <FlagOutlinedIcon sx={icon} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {REPORTS.map((r) => (
          <MenuItem key={r.rating} onClick={() => submit(r.rating)}>
            {r.label}
          </MenuItem>
        ))}
      </Menu>
      {failed && (
        <Typography variant="caption" color="error" role="alert">
          Could not send feedback.
        </Typography>
      )}
    </Stack>
  );
}
