import { Paper } from "@mui/material";
import TicketDraftForm from "./TicketDraftForm";

const frame = { p: 1.5, mt: 1, bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)", borderRadius: "14px", color: "var(--sv-text)" };

// The ticket being raised. While the details are being entered it is ONE form (title, priority, department,
// problem summary and CC people) shown on the latest message only. At the review the review text above lists
// every field and the confirm card below raises it, so nothing more is drawn here. `active` is true only for
// the latest draft message, so older copies stay hidden.
export default function TicketDraftCard({ draft, onSend, onNavigate, tools, active = false, disabled = false }) {
  if (!draft?.options || !active || !tools) return null;
  return (
    <Paper variant="outlined" aria-label="Ticket being raised" sx={frame}>
      <TicketDraftForm draft={draft} tools={tools} onSend={onSend} onNavigate={onNavigate} disabled={disabled} />
    </Paper>
  );
}
