import { Box, Paper, Typography } from "@mui/material";
import TicketDraftForm from "./TicketDraftForm";
import { AttachmentChip, totalsText } from "./DraftAttachments";

const frame = { p: 1.5, mt: 1, bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)", borderRadius: "14px", color: "var(--sv-text)" };

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

// The ticket being raised. While the details are being entered it is ONE form (title, priority, department,
// problem summary, CC people and files) shown on the latest message only; at the review it is the list of files
// (with Open and Remove), because the review text above already lists every field. `active` is true only for the
// latest draft message, so older cards stay read-only (or hidden).
export default function TicketDraftCard({ draft, previews = {}, onRemove, onSend, tools, active = false, disabled = false, compact = false }) {
  if (!draft) return null;

  if (draft.options) {
    if (!active || !tools) return null;
    return (
      <Paper variant="outlined" aria-label="Ticket being raised" sx={frame}>
        <TicketDraftForm draft={draft} previews={previews} tools={tools} onSend={onSend} disabled={disabled} />
      </Paper>
    );
  }

  const files = draft.attachments || [];
  const given = [
    ["Title", draft.title],
    ["Priority", draft.priority],
    ["From Department", draft.fromDepartment],
    ["Department", draft.department],
    ["Custom CC", draft.cc?.length ? draft.cc.join(", ") : null],
    ["Problem Summary", draft.summary ? `${draft.summary} (${draft.words}/${draft.maxWords} words)` : null],
  ].filter(([, v]) => v);
  if (compact && !files.length) return null;
  return (
    <Paper variant="outlined" aria-label="Ticket being raised" sx={frame}>
      {!compact && given.length > 0 && (
        <Box sx={{ display: "grid", gap: 0.75, mb: files.length ? 1.25 : 0 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Ticket details
          </Typography>
          {given.map(([label, value]) => (
            <Row key={label} label={label}>
              {value}
            </Row>
          ))}
        </Box>
      )}
      {files.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ color: "var(--sv-muted)", fontWeight: 600 }}>
            Attachments ({totalsText(files, draft.limits)})
          </Typography>
          <Box component="ul" aria-label="Attachments" sx={{ listStyle: "none", m: 0, mt: 0.5, p: 0, display: "grid", gap: 0.75 }}>
            {files.map((f) => (
              <AttachmentChip key={f.id} file={f} previewUrl={previews[f.id]} onOpen={active ? tools?.open : null} onRemove={active ? onRemove : null} disabled={disabled} />
            ))}
          </Box>
        </Box>
      )}
    </Paper>
  );
}
