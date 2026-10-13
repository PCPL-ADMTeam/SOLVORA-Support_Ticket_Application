import { Box, IconButton, InputBase, Tooltip } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import MicNoneOutlinedIcon from "@mui/icons-material/MicNoneOutlined";
import { focusRing, reducedMotion } from "./theme/chatStyles";

const MAX_LENGTH = 1000;
const ghost = { color: "var(--sv-muted)", ...focusRing };

// Sticky pill-shaped composer. Voice is a visible but disabled placeholder (not implemented yet). Files are
// not taken in the chat: a ticket that needs them is raised on the Create Ticket page.
export default function ChatInput({ placeholder = "Ask about tickets...", value, onChange, onSubmit, inputRef, loading }) {
  const canSend = !loading && Boolean(value.trim());
  return (
    <Box component="form" onSubmit={onSubmit} sx={{ flexShrink: 0, p: 1.5, bgcolor: "var(--sv-surface)", borderTop: "1px solid var(--sv-border)" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.25,
          minHeight: 52,
          pl: 1.5,
          pr: 0.75,
          borderRadius: 99,
          bgcolor: "var(--sv-bg)",
          border: "1px solid var(--sv-border)",
          transition: "border-color var(--sv-fast) ease, box-shadow var(--sv-fast) ease",
          "&:focus-within": { borderColor: "var(--sv-focus)", boxShadow: "0 0 0 3px var(--sv-accent-soft)" },
          ...reducedMotion,
        }}
      >
        <InputBase
          inputRef={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          fullWidth
          multiline
          maxRows={4}
          inputProps={{ maxLength: MAX_LENGTH, "aria-label": "Message to the assistant" }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) onSubmit(e);
          }}
          sx={{ color: "var(--sv-text)", fontSize: 14.5, py: 1, "& textarea::placeholder": { color: "var(--sv-muted)", opacity: 1 } }}
        />
        <Tooltip title="Voice input is not available yet">
          <span>
            <IconButton size="small" disabled aria-label="Voice input (not available yet)" sx={ghost}>
              <MicNoneOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Send">
          <span>
            <IconButton
              type="submit"
              aria-label="Send message"
              disabled={!canSend}
              sx={{
                width: 38,
                height: 38,
                color: "var(--sv-on-accent)",
                background: "var(--sv-accent-gradient)",
                transition: "transform var(--sv-fast) ease, opacity var(--sv-fast) ease",
                "&:hover": { background: "var(--sv-accent-gradient)", transform: "scale(1.06)" },
                "&.Mui-disabled": { background: "var(--sv-border)", color: "var(--sv-muted)" },
                ...focusRing,
                ...reducedMotion,
              }}
            >
              <SendIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
