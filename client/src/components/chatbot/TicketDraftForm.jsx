import { useEffect, useId, useRef, useState } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import FlagOutlinedIcon from "@mui/icons-material/FlagOutlined";
import ApartmentOutlinedIcon from "@mui/icons-material/ApartmentOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CloseIcon from "@mui/icons-material/Close";
import { focusRing, reducedMotion } from "./theme/chatStyles";

const countWords = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

const fieldBox = { display: "flex", alignItems: "center", gap: 1, px: 1.25, minHeight: 42, bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)", borderRadius: "10px", "&:focus-within": { borderColor: "var(--sv-focus)", boxShadow: "0 0 0 3px var(--sv-accent-soft)" } };
const inputStyle = { flex: 1, minWidth: 0, font: "inherit", fontSize: 14, color: "var(--sv-text)", background: "transparent", border: 0, outline: 0, padding: "10px 0" };
const smallBtn = { font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", px: 1.25, py: 0.6, borderRadius: "10px", color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)", border: "1px solid transparent", "&:disabled": { opacity: 0.55, cursor: "default" }, ...focusRing, ...reducedMotion };

function Field({ id, label, optional, children }) {
  return (
    <Box>
      <Typography component="label" htmlFor={id} variant="caption" sx={{ display: "block", mb: 0.5, color: "var(--sv-text)", fontWeight: 600 }}>
        {label} {optional ? <span style={{ fontWeight: 400, color: "var(--sv-muted)" }}>(optional)</span> : <span aria-hidden>*</span>}
      </Typography>
      {children}
    </Box>
  );
}

// Files are not taken in the chat: a short note, with the Create Ticket page for a ticket that needs them.
function NoFilesNote({ draft, onNavigate }) {
  return (
    <Box role="note" aria-label="About attachments" sx={{ display: "flex", alignItems: "flex-start", gap: 1, p: 1.1, borderRadius: "10px", bgcolor: "var(--sv-accent-soft)", border: "1px dashed var(--sv-accent-ink)" }}>
      <InfoOutlinedIcon aria-hidden sx={{ fontSize: 18, mt: 0.15, color: "var(--sv-accent-ink)" }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ color: "var(--sv-text)" }}>
          {draft.filesNote || "You can raise a ticket here without attachments. To attach files, use the Create Ticket page instead."}
        </Typography>
        {draft.createPage && (
          <Box
            component="button"
            type="button"
            onClick={() => onNavigate?.(draft.createPage)}
            sx={{ mt: 0.5, p: 0, display: "inline-flex", alignItems: "center", gap: 0.5, font: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "var(--sv-accent-ink)", bgcolor: "transparent", border: 0, textDecoration: "underline", textUnderlineOffset: 3, ...focusRing }}
          >
            {draft.createPage.label}
            <OpenInNewIcon aria-hidden sx={{ fontSize: 14 }} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

// The ticket, in ONE form: title, priority, department, problem summary and people in CC. "Review Ticket"
// sends it all at once; nothing is created until Raise Ticket on the review. No files: the note links to the
// Create Ticket page for a ticket that needs them.
export default function TicketDraftForm({ draft, tools, onSend, onNavigate, disabled }) {
  const uid = useId();
  const [title, setTitle] = useState(draft.title || "");
  const [priority, setPriority] = useState(draft.priority || "");
  const [department, setDepartment] = useState(draft.department || "");
  const [summary, setSummary] = useState(draft.summary || "");
  const [cc, setCc] = useState(draft.ccUsers || []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const searchSeq = useRef(0);

  const maxWords = draft.maxWords || 50;
  const words = countWords(summary);
  const off = Boolean(disabled || busy);
  const ready = title.trim() && priority && department && summary.trim() && words <= maxWords;
  const dirty = Boolean(title.trim() || priority || department || summary.trim() || cc.length);

  // The people search runs a moment after typing stops, and a late answer never replaces a newer one.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return undefined;
    }
    const seq = (searchSeq.current += 1);
    const t = setTimeout(async () => {
      const r = await tools.searchCc(q);
      if (seq === searchSeq.current) setResults((r.users || []).filter((u) => !cc.some((c) => c.id === u.id)));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const pick = (u) => {
    setCc((prev) => (prev.some((c) => c.id === u.id) ? prev : [...prev, { id: u.id, name: u.name, email: u.email }]));
    setQuery("");
    setResults([]);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || off) return;
    setError("");
    setBusy(true);
    const r = await tools.review({ title: title.trim(), priority, department, problemSummary: summary.trim(), ccUserIds: cc.map((c) => c.id) });
    setBusy(false);
    // On success the review replaces this form; on a refusal the form keeps everything and says why.
    if (r?.error) setError(r.error);
  };

  const cancel = () => {
    if (dirty && !confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    onSend("cancel");
  };

  return (
    <Box component="form" onSubmit={submit} aria-label="Raise a ticket form" sx={{ display: "grid", gap: 1.25 }}>
      <NoFilesNote draft={draft} onNavigate={onNavigate} />
      <Field id={`${uid}-title`} label="Title">
        <Box sx={fieldBox}>
          <input id={`${uid}-title`} style={inputStyle} value={title} maxLength={200} placeholder="Enter a short issue title" onChange={(e) => setTitle(e.target.value)} />
        </Box>
      </Field>
      <Field id={`${uid}-priority`} label="Priority">
        <Box sx={fieldBox}>
          <FlagOutlinedIcon aria-hidden sx={{ fontSize: 18, color: "var(--sv-warning)" }} />
          <select id={`${uid}-priority`} style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Select priority</option>
            {(draft.options.priorities || []).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Box>
      </Field>
      <Field id={`${uid}-department`} label="Department">
        <Box sx={fieldBox}>
          <ApartmentOutlinedIcon aria-hidden sx={{ fontSize: 18, color: "var(--sv-muted)" }} />
          <select id={`${uid}-department`} style={inputStyle} value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Select department</option>
            {(draft.options.departments || []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Box>
      </Field>
      <Field id={`${uid}-summary`} label="Problem Summary">
        <Box sx={{ ...fieldBox, alignItems: "flex-start" }}>
          <textarea id={`${uid}-summary`} rows={3} style={{ ...inputStyle, resize: "vertical" }} value={summary} placeholder={`Describe the problem (up to ${maxWords} words)`} onChange={(e) => setSummary(e.target.value)} />
        </Box>
        <Typography variant="caption" sx={{ color: words > maxWords ? "var(--sv-error)" : "var(--sv-muted)" }}>
          {words}/{maxWords} words
        </Typography>
      </Field>

      <Box role="group" aria-label="People in CC">
        <Typography component="label" htmlFor={`${uid}-cc`} variant="caption" sx={{ display: "block", mb: 0.5, color: "var(--sv-text)", fontWeight: 600 }}>
          Add people in CC <span style={{ fontWeight: 400, color: "var(--sv-muted)" }}>(optional)</span>
        </Typography>
        {cc.length > 0 && (
          <Box component="ul" aria-label="Selected CC people" sx={{ listStyle: "none", m: 0, mb: 0.75, p: 0, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {cc.map((u) => (
              <Box component="li" key={u.id} sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, pl: 1.1, pr: 0.25, py: 0.15, borderRadius: 99, fontSize: 13, color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)", border: "1px solid var(--sv-accent-ink)" }}>
                {u.name}
                <IconButton size="small" aria-label={`Remove ${u.name} from CC`} onClick={() => setCc((prev) => prev.filter((c) => c.id !== u.id))} disabled={off} sx={{ p: 0.25 }}>
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}
        <Box sx={fieldBox}>
          <input id={`${uid}-cc`} style={inputStyle} value={query} placeholder="Search by name or email" autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
        </Box>
        {results.length > 0 && (
          <Box component="ul" aria-label="People found" sx={{ listStyle: "none", m: 0, mt: 0.5, p: 0, border: "1px solid var(--sv-border)", borderRadius: "10px", bgcolor: "var(--sv-surface)", overflow: "hidden" }}>
            {results.map((u) => (
              <Box component="li" key={u.id}>
                <Box component="button" type="button" onClick={() => pick(u)} sx={{ width: "100%", textAlign: "left", font: "inherit", fontSize: 13.5, cursor: "pointer", px: 1.25, py: 0.8, color: "var(--sv-text)", bgcolor: "transparent", border: 0, "&:hover": { bgcolor: "var(--sv-accent-soft)" }, ...focusRing }}>
                  {u.name}
                  <Box component="span" sx={{ color: "var(--sv-muted)" }}>
                    {" "}
                    · {u.email}
                    {u.department ? ` · ${u.department}` : ""}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {error && (
        <Typography role="alert" variant="body2" sx={{ color: "var(--sv-error)" }}>
          {error}
        </Typography>
      )}

      {confirmCancel ? (
        <Box role="alertdialog" aria-label="Discard this ticket?" sx={{ p: 1.25, borderRadius: "10px", bgcolor: "var(--sv-accent-soft)" }}>
          <Typography variant="body2" sx={{ mb: 1, color: "var(--sv-text)" }}>
            Discard this ticket? What you entered will be lost.
          </Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Box component="button" type="button" onClick={() => onSend("cancel")} disabled={disabled} sx={{ ...smallBtn, color: "var(--sv-on-accent)", background: "var(--sv-accent-gradient)" }}>
              Yes, discard
            </Box>
            <Box component="button" type="button" onClick={() => setConfirmCancel(false)} sx={smallBtn}>
              Keep editing
            </Box>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 1 }}>
          <Box component="button" type="button" onClick={cancel} disabled={off} sx={{ ...smallBtn, py: 1, fontSize: 14 }}>
            Cancel
          </Box>
          <Box
            component="button"
            type="submit"
            disabled={!ready || off}
            sx={{ font: "inherit", fontWeight: 700, cursor: "pointer", py: 1, borderRadius: "10px", color: "var(--sv-on-accent)", background: "var(--sv-accent-gradient)", border: 0, "&:disabled": { background: "var(--sv-border)", color: "var(--sv-muted)", cursor: "default" }, ...focusRing, ...reducedMotion }}
          >
            {busy ? "Checking…" : "Review Ticket"}
          </Box>
        </Box>
      )}
    </Box>
  );
}
