import { useState, useEffect, useRef } from "react";
import { Stack, Typography, Box, Link as MuiLink, IconButton, Dialog, CircularProgress } from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseIcon from "@mui/icons-material/Close";
import { ticketsApi } from "../../api/tickets";
import { ignoreBackdropClick } from "../../utils/dialog";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(a) {
  return a.mimeType?.startsWith("image/");
}

// Attachments are no longer served from a public static path — the backend
// streams them only after checking the caller can see this ticket (see
// ticket.service.js#streamAttachment), which means every request needs the
// same Bearer auth header as the rest of the app's API calls. A plain
// <img src="..."> or <a href="..."> can't attach that header, so instead
// each file is fetched as a Blob through the existing authenticated axios
// instance (ticketsApi.downloadAttachment) and rendered from an object URL
// — image thumbnails eagerly (so previews still "just work"), other files
// on demand when the user clicks to download.
export default function AttachmentList({ ticketId, attachments }) {
  const [preview, setPreview] = useState(null);
  const [imageUrls, setImageUrls] = useState({});
  const [downloadingId, setDownloadingId] = useState(null);
  const objectUrlsRef = useRef([]);

  const images = attachments.filter(isImage);
  const files = attachments.filter((a) => !isImage(a));
  const imageIds = images.map((a) => a.id).join(",");

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      images.map(async (a) => {
        try {
          const { data } = await ticketsApi.downloadAttachment(ticketId, a.id);
          const url = URL.createObjectURL(data);
          objectUrlsRef.current.push(url);
          return [a.id, url];
        } catch {
          return null;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setImageUrls(Object.fromEntries(entries.filter(Boolean)));
    });

    return () => {
      cancelled = true;
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, imageIds]);

  const handleDownload = async (a) => {
    setDownloadingId(a.id);
    try {
      const { data } = await ticketsApi.downloadAttachment(ticketId, a.id);
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        <AttachFileIcon fontSize="small" sx={{ verticalAlign: "middle", mr: 0.5 }} />
        Attachments
      </Typography>
      {attachments.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No attachments</Typography>
      ) : (
        <Stack spacing={2}>
          {images.length > 0 && (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
              {images.map((a) => (
                <Box key={a.id} sx={{ width: 96 }}>
                  <Box sx={{ position: "relative", width: 96, height: 96 }}>
                    {imageUrls[a.id] ? (
                      <Box
                        component="img"
                        src={imageUrls[a.id]}
                        alt={a.fileName}
                        onClick={() => setPreview(a)}
                        sx={{
                          width: 96,
                          height: 96,
                          objectFit: "cover",
                          borderRadius: 2,
                          border: 1,
                          borderColor: "divider",
                          display: "block",
                          cursor: "pointer",
                        }}
                      />
                    ) : (
                      <Box
                        sx={{
                          width: 96,
                          height: 96,
                          borderRadius: 2,
                          border: 1,
                          borderColor: "divider",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <CircularProgress size={20} />
                      </Box>
                    )}
                    {imageUrls[a.id] && (
                      <IconButton
                        size="small"
                        onClick={() => setPreview(a)}
                        title="Expand"
                        sx={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          p: 0.5,
                          bgcolor: "rgba(0, 0, 0, 0.55)",
                          color: "#fff",
                          "&:hover": { bgcolor: "rgba(0, 0, 0, 0.75)" },
                        }}
                      >
                        <OpenInFullIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", mt: 0.5 }}>
                    {a.fileName}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {files.length > 0 && (
            <Stack spacing={1}>
              {files.map((a) => (
                <Box key={a.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <InsertDriveFileIcon fontSize="small" color="action" />
                  <MuiLink
                    component="button"
                    type="button"
                    underline="hover"
                    onClick={() => handleDownload(a)}
                    disabled={downloadingId === a.id}
                    sx={{ flex: 1, textAlign: "left" }}
                  >
                    {a.fileName}
                  </MuiLink>
                  {downloadingId === a.id && <CircularProgress size={14} />}
                  <Typography variant="caption" color="text.secondary">{formatSize(a.fileSize)}</Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      )}

      <Dialog
        open={Boolean(preview)}
        onClose={ignoreBackdropClick(() => setPreview(null))}
        maxWidth={false}
        PaperProps={{
          sx: {
            bgcolor: "transparent",
            boxShadow: "none",
            overflow: "visible",
            m: 2,
            maxWidth: "95vw",
            maxHeight: "95vh",
          },
        }}
      >
        {preview && (
          <Box
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              maxWidth: "95vw",
              maxHeight: "95vh",
            }}
          >
            <IconButton
              onClick={() => setPreview(null)}
              title="Close"
              aria-label="Close"
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
              src={imageUrls[preview.id]}
              alt={preview.fileName}
              sx={{
                display: "block",
                width: "auto",
                height: "auto",
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
    </Box>
  );
}
