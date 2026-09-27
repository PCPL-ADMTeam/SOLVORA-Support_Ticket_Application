import { useEffect, useState, useCallback, useRef } from "react";
import {
  Box,
  Typography,
  Paper,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Stack,
  FormControlLabel,
  Switch,
  Button,
  Divider,
  Alert,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import CodeIcon from "@mui/icons-material/Code";
import DOMPurify from "dompurify";
import { useSnackbar } from "notistack";
import { emailTemplatesApi } from "../../api/emailTemplates";
import LoadingState from "../../components/common/LoadingState";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import DialogCloseButton from "../../components/common/DialogCloseButton";
import { ignoreBackdropClick } from "../../utils/dialog";

// Separate from components/common/SafeHtml's config (that one's for
// rich-text ticket descriptions and deliberately strips `style`) — email
// bodies rely entirely on inline CSS for the "View Ticket" button and
// layout (Outlook/email clients don't support external stylesheets), so
// `style` must be allowed here for the preview to look like the real
// email. DOMPurify still strips <script>, onclick=/onerror=/onload=, and
// javascript: URLs regardless of this allow-list.
const EMAIL_PREVIEW_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ["div", "p", "br", "strong", "em", "u", "s", "span", "table", "thead", "tbody", "tr", "td", "th", "a", "h1", "h2", "h3", "h4", "blockquote", "ul", "ol", "li", "img", "hr"],
  ALLOWED_ATTR: ["href", "style", "target", "rel", "width", "height", "cellpadding", "cellspacing", "border", "align", "valign", "src", "alt", "colspan", "rowspan"],
};

// Sample data used ONLY for the in-dialog Preview — never sent anywhere,
// never touches the database. Mirrors the placeholder set
// emailTemplate.service.js#buildPlaceholders actually populates from a
// real ticket, just with example values.
const PREVIEW_SAMPLE = {
  recipientName: "Jamie User",
  ticketNumber: "TKT-00001",
  title: "Laptop won't power on",
  department: "Hardware",
  issue: "Laptop / Desktop Issue",
  priority: "High",
  status: "OPEN",
  requesterName: "Jamie User",
  assigneeName: "Ravi",
  comment: "I've checked the power cable and it looks fine.",
  resolution: "RESOLVED",
  managerName: "Alex Agent",
  commentAuthor: "Ravi",
  oldStatus: "OPEN",
  newStatus: "IN_PROGRESS",
  ticketLink: "https://helpdesk.local/tickets/sample-id",
  resolutionNotes: "Power BI license was reassigned and access was verified.",
  closedReason: "Issue was resolved and confirmed by the requester.",
  // Deliberately blank — mirrors emailTemplate.service.js#buildPlaceholders
  // only ever populating onHoldReason when the change is actually TO
  // ON_HOLD (this sample's newStatus above is IN_PROGRESS). Combined with
  // stripEmptyLabeledRows below, this lets the TICKET_STATUS_CHANGED
  // preview show exactly what a real OPEN/IN_PROGRESS email looks like:
  // no empty "Reason" row.
  onHoldReason: "",
};

// Mirrors emailTemplate.service.js#stripEmptyLabeledRows exactly, so the
// preview never shows a blank labeled row the real email wouldn't send
// either — see that function's comment for why this exists instead of a
// template engine.
function stripEmptyLabeledRows(html) {
  // [^<]* (not .*?) for the label cell — see the identical helper in
  // emailTemplate.service.js for why a plain `.*?` would incorrectly span
  // across row boundaries and strip more than just the one empty row.
  return html.replace(/<tr>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*>\s*<\/td>\s*<\/tr>/g, "");
}

function renderPreview(str) {
  if (!str) return "";
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => (PREVIEW_SAMPLE[key] !== undefined ? PREVIEW_SAMPLE[key] : ""));
}

export default function EmailTemplatesPage() {
  const { enqueueSnackbar } = useSnackbar();
  const [templates, setTemplates] = useState([]);
  const [placeholders, setPlaceholders] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await emailTemplatesApi.list();
    setTemplates(data.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { emailTemplatesApi.placeholders().then(({ data }) => setPlaceholders(data.data)); }, []);

  const [editTarget, setEditTarget] = useState(null);

  if (loading) return <LoadingState />;

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h4">Email Templates</Typography>
        <Typography variant="body2" color="text.secondary">
          These control what ticket-lifecycle emails say. PostgreSQL is the source of truth — edits here take effect immediately for new notifications.
        </Typography>
      </Box>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Event Key</TableCell>
              <TableCell>Subject</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id} hover>
                <TableCell>{t.name}</TableCell>
                <TableCell><Chip size="small" label={t.eventKey} /></TableCell>
                <TableCell sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.subject}
                </TableCell>
                <TableCell>
                  <Chip size="small" label={t.isActive ? "Active" : "Inactive"} color={t.isActive ? "success" : "default"} />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => setEditTarget(t)}><EditIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {editTarget && (
        <EditTemplateDialog
          template={editTarget}
          placeholders={placeholders}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load(); enqueueSnackbar("Email template saved", { variant: "success" }); }}
          onError={(err) => enqueueSnackbar(err.response?.data?.message || "Save failed", { variant: "error" })}
        />
      )}
    </Box>
  );
}

function EditTemplateDialog({ template, placeholders, onClose, onSaved, onError }) {
  const [form, setForm] = useState({
    name: template.name,
    subject: template.subject,
    body: template.body,
    isActive: template.isActive,
  });
  const [saving, setSaving] = useState(false);
  const [deactivateConfirmOpen, setDeactivateConfirmOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const bodyFieldRef = useRef(null);

  const handleToggleActive = (checked) => {
    if (!checked) {
      setDeactivateConfirmOpen(true);
    } else {
      setForm((f) => ({ ...f, isActive: true }));
    }
  };

  const insertPlaceholder = (placeholder) => {
    const token = `{{${placeholder}}}`;
    const el = bodyFieldRef.current;
    if (el && typeof el.selectionStart === "number") {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      setForm((f) => ({ ...f, body: f.body.slice(0, start) + token + f.body.slice(end) }));
      // Restore focus/cursor after the inserted token on the next tick.
      requestAnimationFrame(() => {
        el.focus();
        el.selectionStart = el.selectionEnd = start + token.length;
      });
    } else {
      setForm((f) => ({ ...f, body: `${f.body}${token}` }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await emailTemplatesApi.update(template.id, form);
      onSaved();
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={ignoreBackdropClick(onClose)} fullWidth maxWidth="md">
      <DialogCloseButton onClose={onClose} />
      <DialogTitle>Edit Email Template — {template.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Event Key" value={template.eventKey} fullWidth disabled helperText="Fixed by the system — cannot be changed" />
          <TextField label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth />
          <TextField
            label="Subject"
            value={form.subject}
            onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
            fullWidth
            helperText="Plain text — email subjects don't render HTML"
          />
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <Typography variant="body2" fontWeight={600}>Body</Typography>
              <Chip size="small" icon={<CodeIcon fontSize="small" />} label="HTML supported" variant="outlined" color="primary" />
            </Stack>
            <TextField
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              fullWidth
              multiline
              minRows={10}
              inputRef={bodyFieldRef}
              placeholder="<p>Hello {{recipientName}}...</p>"
              inputProps={{ style: { fontFamily: "monospace", fontSize: 13 } }}
              helperText='This is raw HTML — use inline "style" attributes (Outlook and other email clients ignore external/embedded stylesheets). Use Preview below to see how it renders.'
            />
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Available variables — click to insert into the body:
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {placeholders.map((p) => (
                <Chip
                  key={p}
                  size="small"
                  label={`{{${p}}}`}
                  onClick={() => insertPlaceholder(p)}
                  sx={{ mb: 0.5, fontFamily: "monospace" }}
                  clickable
                />
              ))}
            </Stack>
          </Box>

          <FormControlLabel
            control={<Switch checked={form.isActive} onChange={(e) => handleToggleActive(e.target.checked)} />}
            label={form.isActive ? "Active — this event sends real emails" : "Inactive — this event's emails are skipped"}
          />

          <Divider />

          <Box>
            <Button size="small" startIcon={<VisibilityIcon />} onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? "Hide Preview" : "Preview with sample data"}
            </Button>

            {showPreview && (
              <Paper variant="outlined" sx={{ p: 2, mt: 1.5, bgcolor: "action.hover" }}>
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  PREVIEW ONLY — sample data, sanitized HTML rendering. Nothing is sent and nothing is saved.
                </Alert>
                <Typography variant="caption" color="text.secondary">Subject</Typography>
                <Typography variant="body2" fontWeight={600} gutterBottom>{renderPreview(form.subject)}</Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>Body (rendered)</Typography>
                <Box
                  sx={{ p: 2, bgcolor: "#fff", border: 1, borderColor: "divider", borderRadius: 1 }}
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(stripEmptyLabeledRows(renderPreview(form.body)), EMAIL_PREVIEW_SANITIZE_CONFIG),
                  }}
                />
              </Paper>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !form.name.trim() || !form.subject.trim() || !form.body.trim()}>
          Save
        </Button>
      </DialogActions>

      <ConfirmDialog
        open={deactivateConfirmOpen}
        title="Deactivate this template?"
        message={`While inactive, "${template.eventKey}" emails will be skipped (the ticket action itself still succeeds — this only affects the email/notification content for this event).`}
        confirmLabel="Deactivate"
        danger
        onClose={() => setDeactivateConfirmOpen(false)}
        onConfirm={() => { setForm((f) => ({ ...f, isActive: false })); setDeactivateConfirmOpen(false); }}
      />
    </Dialog>
  );
}
