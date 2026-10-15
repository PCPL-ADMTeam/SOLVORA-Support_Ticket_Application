import { useEffect, useRef, useState } from "react";
import {
  Box,
  Typography,
  Avatar,
  TextField,
  IconButton,
  FormControlLabel,
  Switch,
  Chip,
  Link as MuiLink,
  Dialog,
  CircularProgress,
  Paper,
  Stack,
  Tooltip,
  Button,
} from "@mui/material";
import { format } from "date-fns";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import SendIcon from "@mui/icons-material/Send";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import CloseIcon from "@mui/icons-material/Close";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import LockIcon from "@mui/icons-material/Lock";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useSnackbar } from "notistack";
import ConfirmDialog from "../common/ConfirmDialog";
import SafeHtml from "../common/SafeHtml";
import EmptyState from "../common/EmptyState";
import { ticketsApi } from "../../api/tickets";
import { ignoreBackdropClick } from "../../utils/dialog";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Comment header geometry, shared so the text below lines up exactly with
// the author's name: avatar width + the header's gap (theme spacing units).
const AVATAR_SIZE = 26;
const HEADER_GAP = 1;
const bodyIndentSx = { pl: (theme) => `calc(${AVATAR_SIZE}px + ${theme.spacing(HEADER_GAP)})` };

function isImage(a) {
  return a.mimeType?.startsWith("image/");
}

// Comment bodies are stored sanitized (HTML-escaped). The inline editor is a
// plain text field, so it is pre-filled with the visible text.
function htmlToText(html) {
  if (!html) return "";
  return new DOMParser().parseFromString(html, "text/html").body.textContent || "";
}

// updatedAt is bumped only by an edit (a new comment's createdAt/updatedAt
// are written together), so a gap of more than a second means "edited".
function isEdited(c) {
  return c.updatedAt && new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime() > 1000;
}

// Renders the public + internal comment thread: each comment as its own
// bordered card (Paper, matching the app's existing "outlined card" language
// — see KpiCard/StatusPieChart), with a reply composer pinned to the bottom
// of the same panel. Internal notes (isInternal) are visually flagged and —
// per RBAC — the API has already stripped them (and their attachments) out
// server-side before an END USER ever sees this list, so no client-side
// filtering is needed here.
export default function CommentThread({ ticketId, comments, isStaff, onAddComment, submitting, currentUserId, onCommentUpdated, onCommentDeleted }) {
  const { enqueueSnackbar } = useSnackbar();
  // Inline edit of ONE comment at a time; the typed text survives a failed save.
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Delete confirmation.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditText(htmlToText(c.body));
    setEditError("");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
    setEditError("");
  };
  const saveEdit = async (c) => {
    if (savingEdit) return;
    const text = editText.trim();
    if (!text) {
      setEditError("Comment text cannot be empty.");
      return;
    }
    setSavingEdit(true);
    try {
      const { data } = await ticketsApi.updateComment(ticketId, c.id, { body: text, expectedUpdatedAt: c.updatedAt });
      onCommentUpdated?.(data.data);
      cancelEdit();
      enqueueSnackbar("Comment updated", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to update comment", { variant: "error" });
    } finally {
      setSavingEdit(false);
    }
  };
  const confirmDelete = async () => {
    if (deleting || !deleteTarget) return;
    setDeleting(true);
    try {
      await ticketsApi.deleteComment(ticketId, deleteTarget.id);
      onCommentDeleted?.(deleteTarget.id);
      if (editingId === deleteTarget.id) cancelEdit();
      setDeleteTarget(null);
      enqueueSnackbar("Comment deleted", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to delete comment", { variant: "error" });
    } finally {
      setDeleting(false);
    }
  };
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState("");
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Attachments are only ever reachable through the same authenticated
  // backend endpoint the ticket-level Attachments panel uses (see
  // AttachmentList.jsx) — never a public/static URL, and Azure credentials
  // never reach the client. Each image is fetched once as a Blob and kept
  // as an object URL; non-image files are fetched on demand when clicked.
  const [imageUrls, setImageUrls] = useState({});
  const [preview, setPreview] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const objectUrlsRef = useRef([]);

  const allImageAttachments = comments.flatMap((c) => (c.attachments || []).filter(isImage));
  const imageIds = allImageAttachments.map((a) => a.id).join(",");
  const canSend = Boolean(body.trim()) || files.length > 0;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments.length]);

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      allImageAttachments.map(async (a) => {
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

  const handleFileChange = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (!picked.length) return;
    const oversized = picked.find((f) => f.size > MAX_FILE_SIZE);
    if (oversized) {
      setFileError(`"${oversized.name}" exceeds the 10 MB limit`);
      return;
    }
    setFileError("");
    setFiles((prev) => [...prev, ...picked]);
  };

  const removeFile = (index) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSend) return;
    onAddComment({ body, isInternal }, files).then(() => {
      setBody("");
      setIsInternal(false);
      setFiles([]);
    });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      {/* Message list — the only scrollable part of this panel */}
      <Box
        ref={listRef}
        sx={{
          maxHeight: { xs: 360, sm: 460 },
          overflowY: comments.length > 0 ? "auto" : "visible",
          p: comments.length > 0 ? 0.5 : 2,
        }}
      >
        {comments.length === 0 ? (
          <EmptyState title="No comments yet" subtitle="Be the first to reply." />
        ) : (
          <Stack spacing={1.5} sx={{ p: 1 }}>
            {comments.map((c) => {
              const images = (c.attachments || []).filter(isImage);
              const nonImageFiles = (c.attachments || []).filter((a) => !isImage(a));
              const hasText = Boolean(c.body?.trim());
              return (
                <Paper
                  key={c.id}
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderRadius: 3,
                    // Soft Solvora-themed tint instead of the old bright
                    // warning/orange — `secondary.light` is the theme's own
                    // pale maroon-pink surface tone (see theme.js), and
                    // `secondary.main` gives the border a bit more definition
                    // than the default divider outline every other comment
                    // card already gets from MuiPaper's theme override.
                    // Public comments are completely untouched (still fall
                    // through to the same "background.paper" as before).
                    bgcolor: c.isInternal ? "secondary.light" : "background.paper",
                    borderColor: c.isInternal ? "secondary.main" : undefined,
                  }}
                >
                  {/* Header: [avatar · name · time · internal chip]  ...  [edit][delete] */}
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", columnGap: HEADER_GAP, rowGap: 0.25, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
                      <Avatar sx={{ width: AVATAR_SIZE, height: AVATAR_SIZE, fontSize: 13, flexShrink: 0 }}>{c.author.name[0]}</Avatar>
                      <Typography variant="body2" fontWeight={600} sx={{ minWidth: 0, wordBreak: "break-word" }}>{c.author.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                        {format(new Date(c.createdAt), "MMM d, h:mm a")}
                        {isEdited(c) && (
                          <Tooltip title={`Edited ${format(new Date(c.updatedAt), "MMM d, h:mm a")}`}>
                            <Box component="span" sx={{ ml: 0.5, fontStyle: "italic" }}>· Edited</Box>
                          </Tooltip>
                        )}
                      </Typography>
                      {c.isInternal && <Chip label="Internal note" size="small" color="secondary" />}
                    </Box>
                    {/* Author-only actions, grouped far right — always visible
                        (no hover needed on mobile); the backend re-checks authorship. */}
                    {c.author.id === currentUserId && editingId !== c.id && (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
                        <Tooltip title="Edit comment">
                          <IconButton
                            size="small"
                            aria-label="Edit comment"
                            onClick={() => startEdit(c)}
                            sx={{ p: 0.5, color: "text.secondary", "&:hover": { color: "text.primary", bgcolor: "action.hover" } }}
                          >
                            <EditOutlinedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete comment">
                          <IconButton
                            size="small"
                            aria-label="Delete comment"
                            onClick={() => setDeleteTarget(c)}
                            sx={{ p: 0.5, color: "text.secondary", "&:hover": { color: "primary.main", bgcolor: "primary.light" } }}
                          >
                            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    )}
                  </Box>

                  {editingId === c.id ? (
                    <Box sx={{ mt: 1, ...bodyIndentSx }}>
                      <TextField
                        autoFocus
                        multiline
                        minRows={2}
                        maxRows={8}
                        fullWidth
                        size="small"
                        value={editText}
                        onChange={(e) => { setEditText(e.target.value); setEditError(""); }}
                        error={Boolean(editError)}
                        helperText={editError}
                        inputProps={{ "aria-label": "Edit comment text" }}
                      />
                      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1 }}>
                        <Button size="small" onClick={cancelEdit} disabled={savingEdit}>Cancel</Button>
                        <Button size="small" variant="contained" onClick={() => saveEdit(c)} disabled={savingEdit}>
                          {savingEdit ? "Saving..." : "Save"}
                        </Button>
                      </Box>
                    </Box>
                  ) : (
                    hasText && (
                      <Box sx={{ mt: 0.5, ...bodyIndentSx, wordBreak: "break-word" }}>
                        <SafeHtml html={c.body} />
                      </Box>
                    )
                  )}

                  {images.length > 0 && (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, mt: 1 }}>
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

                  {nonImageFiles.length > 0 && (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 1 }}>
                      {nonImageFiles.map((a) => (
                        <Box key={a.id} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                          <InsertDriveFileIcon fontSize="small" color="action" />
                          <MuiLink
                            component="button"
                            type="button"
                            underline="hover"
                            variant="body2"
                            onClick={() => handleDownload(a)}
                            disabled={downloadingId === a.id}
                            sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}
                          >
                            {a.fileName}
                          </MuiLink>
                          {downloadingId === a.id && <CircularProgress size={14} />}
                          <Typography variant="caption" color="text.secondary">{formatSize(a.fileSize)}</Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Paper>
              );
            })}
          </Stack>
        )}
      </Box>

      {/* Reply composer — fixed at the bottom of the panel, never scrolls */}
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{ borderTop: 1, borderColor: "divider", p: 1.5, bgcolor: "background.paper" }}
      >
        {files.length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}>
            {files.map((f, i) => (
              <Chip
                key={`${f.name}-${i}`}
                icon={<InsertDriveFileIcon />}
                label={`${f.name} (${formatSize(f.size)})`}
                onDelete={() => removeFile(i)}
                deleteIcon={<CloseIcon />}
              />
            ))}
          </Box>
        )}
        {fileError && <Typography variant="caption" color="error" display="block" sx={{ mb: 0.5 }}>{fileError}</Typography>}

        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1 }}>
          <IconButton size="small" onClick={() => inputRef.current?.click()} title="Attach files" sx={{ mb: 0.5 }}>
            <AttachFileIcon fontSize="small" />
          </IconButton>
          <input ref={inputRef} type="file" multiple hidden onChange={handleFileChange} />

          <TextField
            multiline
            maxRows={4}
            fullWidth
            size="small"
            placeholder="Write a reply, or attach a file..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            sx={{ "& .MuiOutlinedInput-root": { borderRadius: 3, bgcolor: "background.default" } }}
          />

          <IconButton type="submit" color="primary" disabled={submitting || !canSend} sx={{ mb: 0.5 }} title="Send">
            <SendIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Compact, neutral "setting" control — deliberately NOT styled as a
            warning/error (no orange/warning palette anywhere here); the
            primary Solvora color is used only to indicate the ON state,
            exactly like any other active toggle in the app. The internal-
            note behavior itself (isInternal state/onChange, RBAC visibility
            server-side) is unchanged — only presentation. */}
        {isStaff && (
          <Box
            sx={{
              mt: 1,
              display: "inline-flex",
              alignItems: "center",
              maxWidth: "100%",
              borderRadius: 2,
              border: 1,
              borderColor: "divider",
              bgcolor: "action.hover",
            }}
          >
            <FormControlLabel
              sx={{ ml: 0.5, mr: 1.25, my: 0.25 }}
              control={
                <Switch
                  size="small"
                  color="primary"
                  checked={isInternal}
                  onChange={(e) => setIsInternal(e.target.checked)}
                />
              }
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, py: 0.25 }}>
                  <LockIcon sx={{ fontSize: 16, color: isInternal ? "primary.main" : "text.secondary" }} />
                  <Box sx={{ lineHeight: 1.2 }}>
                    <Typography variant="caption" fontWeight={600} color="text.primary" display="block" lineHeight={1.3}>
                      Internal note
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: 11, lineHeight: 1.3 }}>
                      Hidden from requester
                    </Typography>
                  </Box>
                </Box>
              }
            />
          </Box>
        )}
      </Box>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Comment"
        message={
          deleteTarget
            ? `Delete this ${deleteTarget.isInternal ? "internal note" : "comment"}${
                htmlToText(deleteTarget.body).trim() ? ` ("${htmlToText(deleteTarget.body).trim().slice(0, 80)}${htmlToText(deleteTarget.body).trim().length > 80 ? "…" : ""}")` : ""
              }? This cannot be undone${deleteTarget.attachments?.length ? " and also removes its attachments" : ""}.`
            : ""
        }
        confirmLabel={deleting ? "Deleting..." : "Delete Comment"}
        danger
        onConfirm={confirmDelete}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
      />

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
