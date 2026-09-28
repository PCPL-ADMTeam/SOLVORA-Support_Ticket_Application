import { useEffect, useRef, useState } from "react";
import { Box, Typography, IconButton, Tooltip, Dialog } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { ignoreBackdropClick } from "../../utils/dialog";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(file) {
  return file.type?.startsWith("image/");
}

function isPdf(file) {
  return file.type === "application/pdf";
}

// Preview cards for a ticket's PENDING (not-yet-uploaded) attachments —
// files staged via either "Upload File" or a Ctrl+V clipboard paste (see
// TicketForm.jsx/RichTextField.jsx), both of which land in the exact same
// `files` array this renders, so there is only ever one attachment UI. Every
// preview is built from a local `URL.createObjectURL(file)` — nothing is
// uploaded to the server just to show a thumbnail or let the user open a
// file before submitting.
//
// Object URLs are created once per File (keyed by object identity, so
// adding/removing one attachment never regenerates every other one's URL)
// and revoked the moment a file is removed, replaced, or this component
// unmounts, per the browser's object-URL memory-leak guidance.
export default function AttachmentPreview({ files, onRemove }) {
  const [urlMap, setUrlMap] = useState(new Map());
  const urlMapRef = useRef(urlMap);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    setUrlMap((prev) => {
      const next = new Map();
      for (const file of files) {
        next.set(file, prev.has(file) ? prev.get(file) : URL.createObjectURL(file));
      }
      for (const [file, url] of prev) {
        if (!next.has(file)) URL.revokeObjectURL(url);
      }
      return next;
    });
  }, [files]);

  useEffect(() => {
    urlMapRef.current = urlMap;
  }, [urlMap]);

  // Unmount-only cleanup — reads the ref (always the latest map) rather than
  // `urlMap` directly, since an effect with an empty dependency array would
  // otherwise only ever see the map from the very first render.
  useEffect(() => () => {
    urlMapRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  if (!files.length) return null;

  const handleOpen = (file) => {
    const url = urlMap.get(file);
    if (!url) return;
    if (isImage(file)) {
      setPreview({ file, url });
    } else {
      // PDFs and every other file type — the browser's own native viewer/
      // download behavior in a new tab, exactly like clicking a normal link.
      window.open(url, "_blank", "noopener");
    }
  };

  return (
    <>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, mt: 1.5 }}>
        {files.map((file, index) => {
          const url = urlMap.get(file);
          return (
            <Box
              key={`${file.name}-${file.lastModified}-${index}`}
              role="button"
              tabIndex={0}
              aria-label={`Open ${file.name}`}
              onClick={() => handleOpen(file)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleOpen(file);
                }
              }}
              sx={{
                width: 140,
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                overflow: "hidden",
                cursor: "pointer",
                bgcolor: "background.paper",
                position: "relative",
                transition: "border-color 0.15s ease",
                "&:hover": { borderColor: "primary.main" },
                "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
              }}
            >
              <Tooltip title="Remove attachment">
                <IconButton
                  aria-label={`Remove ${file.name}`}
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(index);
                  }}
                  sx={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    zIndex: 1,
                    p: 0.4,
                    bgcolor: "rgba(0, 0, 0, 0.55)",
                    color: "#fff",
                    "&:hover": { bgcolor: "rgba(0, 0, 0, 0.75)" },
                  }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>

              <Box
                sx={{
                  width: "100%",
                  height: 90,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "action.hover",
                }}
              >
                {isImage(file) && url ? (
                  <Box component="img" src={url} alt={file.name} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : isPdf(file) ? (
                  <PictureAsPdfIcon sx={{ fontSize: 40, color: "primary.main" }} />
                ) : (
                  <InsertDriveFileIcon sx={{ fontSize: 40, color: "text.secondary" }} />
                )}
              </Box>

              <Box sx={{ p: 0.75 }}>
                <Typography variant="caption" noWrap sx={{ display: "block", fontWeight: 600 }}>
                  {file.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {formatSize(file.size)}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Image lightbox — same pattern as AttachmentList.jsx/CommentThread.jsx
          use for already-uploaded attachments, just backed by a local object
          URL instead of an authenticated download. */}
      <Dialog
        open={Boolean(preview)}
        onClose={ignoreBackdropClick(() => setPreview(null))}
        maxWidth={false}
        PaperProps={{
          sx: { bgcolor: "transparent", boxShadow: "none", overflow: "visible", m: 2, maxWidth: "95vw", maxHeight: "95vh" },
        }}
      >
        {preview && (
          <Box sx={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", maxWidth: "95vw", maxHeight: "95vh" }}>
            <IconButton
              onClick={() => setPreview(null)}
              aria-label="Close preview"
              sx={{
                position: "absolute",
                top: -16,
                right: -16,
                bgcolor: "rgba(0, 0, 0, 0.65)",
                color: "#fff",
                "&:hover": { bgcolor: "rgba(0, 0, 0, 0.85)" },
              }}
            >
              <CloseIcon />
            </IconButton>
            <Box
              component="img"
              src={preview.url}
              alt={preview.file.name}
              sx={{
                display: "block",
                maxWidth: "95vw",
                maxHeight: "95vh",
                objectFit: "contain",
                borderRadius: 1,
                boxShadow: 6,
                bgcolor: "background.paper",
              }}
            />
          </Box>
        )}
      </Dialog>
    </>
  );
}
