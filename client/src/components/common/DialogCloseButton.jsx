import { IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

// A single, reusable top-right X for every Dialog in the app — MUI's Dialog
// Paper is already position:relative, so this positions correctly as a
// direct child of <Dialog> with no extra wrapper needed. Deliberately plain
// neutral coloring (text.secondary, primary.main only on hover) — never the
// warning/error palette.
export default function DialogCloseButton({ onClose }) {
  return (
    <IconButton
      onClick={onClose}
      aria-label="Close"
      size="small"
      sx={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 1,
        color: "text.secondary",
        "&:hover": { bgcolor: "action.hover", color: "primary.main" },
      }}
    >
      <CloseIcon fontSize="small" />
    </IconButton>
  );
}
