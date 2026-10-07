import { useRef } from "react";
import { Box, IconButton, InputBase, Tooltip } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import MicNoneOutlinedIcon from "@mui/icons-material/MicNoneOutlined";
import { focusRing, reducedMotion } from "./theme/chatStyles";

const MAX_LENGTH = 1000;
const ghost = { color: "var(--sv-muted)", ...focusRing };

// Sticky pill-shaped composer. Attachment and voice are visible but disabled
// placeholders (not implemented yet); sending behavior is unchanged.
export default function ChatInput({ value, onChange, onSubmit, inputRef, loading, canAttach = false, onFiles }) {
  const canSend = !loading && Boolean(value.trim());
  const picker = useRef(null);

  // A pasted screenshot becomes an attachment of the ticket being raised, never text in the message.
  const onPaste = (e) => {
    if (!canAttach || !onFiles) return;
    const images = Array.from(e.clipboardData?.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item, i, all) => {
        const blob = item.getAsFile();
        if (!blob) return null;
        const ext = (item.type.split("/")[1] || "png").replace("jpeg", "jpg");
        return new File([blob], `pasted-image-${Date.now()}${all.length > 1 ? `-${i + 1}` : ""}.${ext}`, { type: item.type });
      })
      .filter(Boolean);
    if (!images.length) return;
    e.preventDefault();
    onFiles(images);
  };
  return (
    <Box component="form" onSubmit={onSubmit} sx={{ flexShrink: 0, p: 1.5, bgcolor: "var(--sv-surface)", borderTop: "1px solid var(--sv-border)" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.25,
          minHeight: 52,
          pl: 0.75,
          pr: 0.75,
          borderRadius: 99,
          bgcolor: "var(--sv-bg)",
          border: "1px solid var(--sv-border)",
          transition: "border-color var(--sv-fast) ease, box-shadow var(--sv-fast) ease",
          "&:focus-within": { borderColor: "var(--sv-focus)", boxShadow: "0 0 0 3px var(--sv-accent-soft)" },
          ...reducedMotion,
        }}
      >
        <Tooltip title={canAttach ? "Attach files to your ticket" : "Start raising a ticket to attach files"}>
          <span>
            <IconButton size="small" disabled={!canAttach || loading} onClick={() => picker.current?.click()} aria-label={canAttach ? "Attach files to the ticket" : "Attach a file (available while raising a ticket)"} sx={ghost}>
              <AttachFileIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-testid="ticket-file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length) onFiles?.(files);
          }}
        />
        <InputBase
          inputRef={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ask about tickets..."
          fullWidth
          multiline
          maxRows={4}
          inputProps={{ maxLength: MAX_LENGTH, "aria-label": "Message to the assistant", onPaste }}
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
