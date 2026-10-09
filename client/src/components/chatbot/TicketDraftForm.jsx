import { useState } from "react";
import { Box, Typography } from "@mui/material";
import FlagOutlinedIcon from "@mui/icons-material/FlagOutlined";
import ApartmentOutlinedIcon from "@mui/icons-material/ApartmentOutlined";
import { focusRing, reducedMotion } from "./theme/chatStyles";

const countWords = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
// The message is split on " | ", so the fields cannot contain it.
const clean = (v) => v.replace(/\s*\|\s*/g, " / ").replace(/\s+/g, " ").trim();

const fieldBox = { display: "flex", alignItems: "center", gap: 1, px: 1.25, minHeight: 42, bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)", borderRadius: "10px", "&:focus-within": { borderColor: "var(--sv-focus)", boxShadow: "0 0 0 3px var(--sv-accent-soft)" } };
const inputStyle = { flex: 1, minWidth: 0, font: "inherit", fontSize: 14, color: "var(--sv-text)", background: "transparent", border: 0, outline: 0, padding: "10px 0" };

function Field({ id, label, children }) {
  return (
    <Box>
      <Typography component="label" htmlFor={id} variant="caption" sx={{ display: "block", mb: 0.5, color: "var(--sv-text)", fontWeight: 600 }}>
        {label} <span aria-hidden>*</span>
      </Typography>
      {children}
    </Box>
  );
}

// The first question of "Raise a ticket", answered as a form: title, priority, department and the
// problem summary. It sends one message in a fixed format that the assistant reads exactly (nothing is
// interpreted), then the usual steps follow: optional CC and files, a review, and your confirmation.
export default function TicketDraftForm({ options, maxWords = 50, onSend, disabled }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("");
  const [department, setDepartment] = useState("");
  const [summary, setSummary] = useState("");
  const words = countWords(summary);
  const ready = title.trim() && priority && department && summary.trim() && words <= maxWords;

  const submit = (e) => {
    e.preventDefault();
    if (!ready || disabled) return;
    onSend(`Title: ${clean(title)} | Priority: ${priority} | Department: ${department} | Problem Summary: ${clean(summary)}`);
  };

  return (
    <Box component="form" onSubmit={submit} aria-label="Raise a ticket form" sx={{ mt: 1.25, display: "grid", gap: 1.25 }}>
      <Field id="rt-title" label="Title">
        <Box sx={fieldBox}>
          <input id="rt-title" style={inputStyle} value={title} maxLength={200} placeholder="Enter a short issue title" onChange={(e) => setTitle(e.target.value)} />
        </Box>
      </Field>
      <Field id="rt-priority" label="Priority">
        <Box sx={fieldBox}>
          <FlagOutlinedIcon aria-hidden sx={{ fontSize: 18, color: "var(--sv-warning)" }} />
          <select id="rt-priority" style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Select priority</option>
            {(options.priorities || []).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Box>
      </Field>
      <Field id="rt-department" label="Department">
        <Box sx={fieldBox}>
          <ApartmentOutlinedIcon aria-hidden sx={{ fontSize: 18, color: "var(--sv-muted)" }} />
          <select id="rt-department" style={inputStyle} value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Select department</option>
            {(options.departments || []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Box>
      </Field>
      <Field id="rt-summary" label="Problem Summary">
        <Box sx={{ ...fieldBox, alignItems: "flex-start" }}>
          <textarea id="rt-summary" rows={3} style={{ ...inputStyle, resize: "vertical" }} value={summary} placeholder={`Describe the problem (up to ${maxWords} words)`} onChange={(e) => setSummary(e.target.value)} />
        </Box>
        <Typography variant="caption" sx={{ color: words > maxWords ? "var(--sv-error)" : "var(--sv-muted)" }}>
          {words}/{maxWords} words
        </Typography>
      </Field>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 1 }}>
        <Box
          component="button"
          type="button"
          onClick={() => onSend("cancel")}
          disabled={disabled}
          sx={{ font: "inherit", fontWeight: 600, cursor: "pointer", py: 1, borderRadius: "10px", color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)", border: "1px solid transparent", "&:disabled": { opacity: 0.55, cursor: "default" }, ...focusRing, ...reducedMotion }}
        >
          Cancel
        </Box>
        <Box
          component="button"
          type="submit"
          disabled={!ready || disabled}
          sx={{ font: "inherit", fontWeight: 700, cursor: "pointer", py: 1, borderRadius: "10px", color: "var(--sv-on-accent)", background: "var(--sv-accent-gradient)", border: 0, "&:disabled": { background: "var(--sv-border)", color: "var(--sv-muted)", cursor: "default" }, ...focusRing, ...reducedMotion }}
        >
          Create Ticket
        </Box>
      </Box>
    </Box>
  );
}
