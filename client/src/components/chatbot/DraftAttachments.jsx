import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";

export const sizeText = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// "2/5 · 1.2 MB of 10 MB": how many files and how much of the shared budget.
export function totalsText(files, limits = {}) {
  const used = files.reduce((n, f) => n + (f.size || 0), 0);
  return `${files.length}/${limits.maxFiles || 5} · ${sizeText(used)} of ${limits.maxMb || 10} MB`;
}

const kindOf = (file) => (file.mimeType === "application/pdf" ? "PDF" : file.mimeType?.startsWith("image/") ? "Image" : "File");

// One attached file: a thumbnail for images (from the local file chosen in this session), a PDF or file
// icon otherwise; its name, type and size; and Open (new tab) / Remove while the ticket can still change.
export function AttachmentChip({ file, previewUrl, onOpen, onRemove, disabled }) {
  const isImage = file.mimeType?.startsWith("image/");
  const isPdf = file.mimeType === "application/pdf";
  return (
    <Box component="li" sx={{ display: "flex", alignItems: "center", gap: 1, p: 0.75, border: "1px solid var(--sv-border)", borderRadius: "12px", bgcolor: "var(--sv-surface)", minWidth: 0 }}>
      {isImage && previewUrl ? (
        <Box component="img" src={previewUrl} alt={`Preview of ${file.name}`} sx={{ width: 40, height: 40, objectFit: "cover", borderRadius: "8px", flexShrink: 0 }} />
      ) : (
        <Box aria-hidden sx={{ width: 40, height: 40, flexShrink: 0, borderRadius: "8px", display: "grid", placeItems: "center", bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)" }}>
          {isPdf ? <PictureAsPdfOutlinedIcon fontSize="small" /> : <InsertDriveFileOutlinedIcon fontSize="small" />}
        </Box>
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600, color: "var(--sv-text)" }}>
          {file.name}
        </Typography>
        <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
          {kindOf(file)} · {sizeText(file.size)}
        </Typography>
      </Box>
      {onOpen && (
        <Tooltip title="Open in a new tab">
          <span>
            <IconButton size="small" aria-label={`Open attachment ${file.name}`} onClick={() => onOpen(file.id)} disabled={disabled}>
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {onRemove && (
        <Tooltip title="Remove">
          <span>
            <IconButton size="small" aria-label={`Remove attachment ${file.name}`} onClick={() => onRemove(file.id)} disabled={disabled}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Box>
  );
}
