import { Box, IconButton, Paper, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";

const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Row({ label, children }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "112px 1fr", gap: 1, alignItems: "baseline" }}>
      <Typography variant="caption" sx={{ color: "var(--sv-muted)", fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-word", color: "var(--sv-text)" }}>
        {children}
      </Typography>
    </Box>
  );
}

// One attached file: a thumbnail for images (from the local file chosen in this session), a PDF
// or file card otherwise, with a remove button until the ticket is raised.
function AttachmentChip({ file, previewUrl, onRemove, disabled }) {
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
          {isPdf ? "PDF" : isImage ? "Image" : "File"} · {size(file.size)}
        </Typography>
      </Box>
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

// The ticket being raised: what has been collected so far, or (at the review) just the files, since
// the review text already lists the fields. `active` is true only for the latest draft message, so
// older cards stay read-only.
export default function TicketDraftCard({ draft, previews = {}, onRemove, active = false, disabled = false, compact = false }) {
  if (!draft) return null;
  const files = draft.attachments || [];
  // Only what has been given is listed; what is still missing is named in one line.
  const given = [
    ["Title", draft.title],
    ["Priority", draft.priority],
    ["From Department", draft.fromDepartment],
    ["Department", draft.department],
    ["Custom CC", draft.cc?.length ? draft.cc.join(", ") : null],
    ["Problem Summary", draft.summary ? `${draft.summary} (${draft.words}/${draft.maxWords} words)` : null],
  ].filter(([, v]) => v);
  const missing = [
    ["Title", draft.title],
    ["Priority", draft.priority],
    ["Department", draft.department],
    ["Problem Summary", draft.summary],
  ]
    .filter(([, v]) => !v)
    .map(([l]) => l);
  const showFiles = files.length > 0 || draft.step === "ATTACH" || draft.step === "REVIEW";
  if (compact && !showFiles) return null;
  return (
    <Paper variant="outlined" aria-label="Ticket being raised" sx={{ p: 1.5, mt: 1, bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)", borderRadius: "14px", color: "var(--sv-text)" }}>
      {!compact && (
        <Box sx={{ display: "grid", gap: 0.75 }}>
          {given.length > 0 && (
            <>
              <Typography variant="subtitle2" fontWeight={700}>
                Added so far
              </Typography>
              {given.map(([label, value]) => (
                <Row key={label} label={label}>
                  {value}
                </Row>
              ))}
            </>
          )}
          {missing.length > 0 && (
            <Typography variant="body2" sx={{ color: "var(--sv-muted)" }}>
              <strong>Still needed:</strong> {missing.join(", ")}
            </Typography>
          )}
        </Box>
      )}
      {showFiles && (
      <Box sx={{ mt: compact || (given.length === 0 && missing.length === 0) ? 0 : 1.25 }}>
        <Typography variant="caption" sx={{ color: "var(--sv-muted)", fontWeight: 600 }}>
          Attachments ({files.length}/{draft.limits?.maxFiles}, up to {draft.limits?.maxMb} MB in total)
        </Typography>
        {files.length ? (
          <Box component="ul" aria-label="Attachments" sx={{ listStyle: "none", m: 0, mt: 0.5, p: 0, display: "grid", gap: 0.75 }}>
            {files.map((f) => (
              <AttachmentChip key={f.id} file={f} previewUrl={previews[f.id]} onRemove={active ? onRemove : null} disabled={disabled} />
            ))}
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: "var(--sv-muted)" }}>
            None{active ? ". Use the attach button or paste a screenshot." : ""}
          </Typography>
        )}
      </Box>
      )}
    </Paper>
  );
}
