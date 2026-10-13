import { useId, useState } from "react";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { focusRing, reducedMotion } from "./theme/chatStyles";

const DONE = {
  EXECUTED: { label: "Done", color: "success" },
  CANCELLED: { label: "Cancelled", color: "default" },
  EXPIRED: { label: "Expired", color: "warning" },
  FAILED: { label: "Not done", color: "error" },
  HISTORY: { label: "From an earlier chat", color: "default" },
  SUPERSEDED: { label: "Being changed", color: "default" },
  REPLACED: { label: "Replaced by your edit", color: "default" },
  CONFIRMING: { label: "In progress", color: "info" },
};

const field = { width: "100%", boxSizing: "border-box", font: "inherit", fontSize: 14, color: "var(--sv-text)", background: "var(--sv-bg)", border: "1px solid var(--sv-border)", borderRadius: 10, padding: "8px 10px" };
const fieldLabel = { display: "block", mb: 0.5, color: "var(--sv-text)", fontWeight: 600 };

// Edit for an assignment, in the card: another eligible person (or a typed name or email) and the note.
// "Update preview" asks for a NEW preview of it; nothing is changed until that preview is confirmed, and
// the server checks the chosen person again exactly as for a typed request.
function AssignEditor({ edit, busy, onSubmit, onBack }) {
  const uid = useId();
  const names = [...new Set([edit.assignee !== "me" ? edit.assignee : null, ...(edit.options || [])].filter(Boolean))];
  const [who, setWho] = useState(edit.assignee || names[0] || "");
  const [other, setOther] = useState("");
  const [note, setNote] = useState(edit.note || "");
  const target = other.trim() || who;
  const submit = (e) => {
    e.preventDefault();
    if (!target || busy) return;
    const cleanNote = note.replace(/\s+/g, " ").trim();
    onSubmit(`Assign ticket ${edit.ticketNumber} to ${target}${cleanNote ? ` with note: ${cleanNote}` : ""}`);
  };
  return (
    <Box component="form" onSubmit={submit} aria-label="Edit the assignment" sx={{ mt: 1.25, p: 1.25, borderRadius: "10px", bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)", display: "grid", gap: 1.1 }}>
      <Box>
        <Typography component="label" htmlFor={`${uid}-who`} variant="caption" sx={fieldLabel}>
          Assign to
        </Typography>
        <select id={`${uid}-who`} style={field} value={who} onChange={(e) => setWho(e.target.value)} disabled={Boolean(other.trim())}>
          {edit.canSelfAssign && <option value="me">Me (Assign to Me)</option>}
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Box>
      <Box>
        <Typography component="label" htmlFor={`${uid}-other`} variant="caption" sx={fieldLabel}>
          Or someone else <span style={{ fontWeight: 400, color: "var(--sv-muted)" }}>(name or email)</span>
        </Typography>
        <input id={`${uid}-other`} style={field} value={other} maxLength={120} placeholder="Type a name or email" onChange={(e) => setOther(e.target.value)} />
      </Box>
      <Box>
        <Typography component="label" htmlFor={`${uid}-note`} variant="caption" sx={fieldLabel}>
          Note for the assignee <span style={{ fontWeight: 400, color: "var(--sv-muted)" }}>(optional, included in the email)</span>
        </Typography>
        <textarea id={`${uid}-note`} rows={2} style={{ ...field, resize: "vertical" }} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button type="submit" variant="contained" size="small" disableElevation disabled={!target || busy} sx={{ background: "var(--sv-accent-gradient)", color: "var(--sv-on-accent)", borderRadius: "10px", textTransform: "none", fontWeight: 700, ...focusRing }}>
          Update preview
        </Button>
        <Button type="button" size="small" onClick={onBack} disabled={busy} sx={{ color: "var(--sv-accent-ink)", borderRadius: "10px", textTransform: "none", ...focusRing }}>
          Back
        </Button>
      </Stack>
      <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
        A new preview is shown. Nothing changes until you confirm it.
      </Typography>
    </Box>
  );
}

// Preview of a change the assistant has PREPARED but not made. Nothing happens
// until the admin presses Confirm, which calls the authenticated confirm
// endpoint; the outcome shown afterwards is whatever the server reports.
export default function ActionConfirmCard({ action, state, onConfirm, onCancel, onEdit }) {
  const status = state?.status && state.status !== "PENDING" ? state.status : null;
  const busy = Boolean(state?.busy);
  // Discarding a ticket that has been filled in asks first: what was entered would be lost.
  const [discarding, setDiscarding] = useState(false);
  // An assignment is edited in the card itself (another person, the note); other changes go back to the composer.
  const [editing, setEditing] = useState(false);
  const isTicket = action.title === "Raise ticket";
  const outcome = status ? DONE[status] : null;
  const editsInCard = action.edit?.kind === "assign";

  return (
    <Paper
      variant="outlined"
      role="group"
      aria-label={`Proposed change: ${action.title}`}
      sx={{ p: 1.5, mt: 1, bgcolor: "var(--sv-bg)", color: "var(--sv-text)", borderRadius: "14px", border: "1px solid var(--sv-border)", borderLeft: "4px solid var(--sv-warning)" }}
    >
      <Typography variant="caption" display="block" sx={{ color: "var(--sv-muted)", fontWeight: 600 }}>
        {action.title === "Raise ticket" ? "Ticket not raised yet" : "Proposed change · not made yet"}
      </Typography>
      <Typography variant="subtitle2" fontWeight={700} sx={{ wordBreak: "break-word" }}>
        {action.summary}
      </Typography>
      {action.impact?.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {action.impact.map((i) => (
            <li key={i}>
              <Typography variant="body2" sx={{ color: "var(--sv-text)" }}>
                {i}
              </Typography>
            </li>
          ))}
        </Box>
      )}

      {outcome ? (
        <Chip size="small" label={outcome.label} color={outcome.color} sx={{ mt: 1 }} role="status" />
      ) : editing ? (
        <AssignEditor edit={action.edit} busy={busy} onSubmit={(text) => onEdit(action, text)} onBack={() => setEditing(false)} />
      ) : (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            size="small"
            disableElevation
            disabled={busy}
            onClick={() => onConfirm(action)}
            aria-label={`Confirm: ${action.summary}`}
            sx={{ background: "var(--sv-accent-gradient)", color: "var(--sv-on-accent)", borderRadius: "10px", ...focusRing, ...reducedMotion }}
          >
            {action.title === "Raise ticket" ? "Raise Ticket" : "Confirm"}
          </Button>
          <Button
            variant="outlined"
            size="small"
            disabled={busy}
            onClick={() => (isTicket ? setDiscarding(true) : onCancel(action))}
            aria-label="Cancel this change"
            sx={{ color: "var(--sv-text)", borderColor: "var(--sv-border)", borderRadius: "10px", ...focusRing }}
          >
            Cancel
          </Button>
          {discarding && (
            <Stack role="alertdialog" aria-label="Discard this ticket?" direction="row" spacing={1} alignItems="center" sx={{ width: "100%", p: 1, borderRadius: "10px", bgcolor: "var(--sv-accent-soft)" }}>
              <Typography variant="body2" sx={{ flex: 1 }}>
                Discard this ticket?
              </Typography>
              <Button size="small" variant="contained" disableElevation disabled={busy} onClick={() => onCancel(action)} sx={{ background: "var(--sv-accent-gradient)", color: "var(--sv-on-accent)", borderRadius: "10px", ...focusRing }}>
                Yes, discard
              </Button>
              <Button size="small" variant="text" onClick={() => setDiscarding(false)} sx={{ color: "var(--sv-accent-ink)", borderRadius: "10px", ...focusRing }}>
                Keep
              </Button>
            </Stack>
          )}
          {/* Edit only where there is something to correct (not for e.g. clearing notifications). */}
          {onEdit && !discarding && action.editable !== false && (
            <Button
              variant="text"
              size="small"
              disabled={busy}
              onClick={() => (editsInCard ? setEditing(true) : onEdit(action))}
              aria-label="Edit this request"
              sx={{ color: "var(--sv-accent-ink)", borderRadius: "10px", ...focusRing }}
            >
              Edit
            </Button>
          )}
        </Stack>
      )}
    </Paper>
  );
}
