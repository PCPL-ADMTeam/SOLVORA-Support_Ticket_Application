import { Box, Stack, Typography } from "@mui/material";
import { format } from "date-fns";
import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import { focusRing, reducedMotion } from "./theme/chatStyles";
import { StatusChip, PriorityChip } from "./TicketChips";

const day = (iso) => (iso ? format(new Date(iso), "MMM d, yyyy") : null);
const openTarget = (t) => ({ type: "route", path: `/tickets/${t.ticketRouteId}`, label: "Open ticket" });

function Reason({ reason }) {
  if (!reason) return null;
  return (
    <Box sx={{ mt: 1, p: 1, borderRadius: "10px", bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)" }}>
      <Typography variant="caption" sx={{ color: "var(--sv-muted)", fontWeight: 700 }}>
        {reason.label}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--sv-text)" }}>
        {reason.text || "No reason recorded."}
      </Typography>
    </Box>
  );
}

function Fact({ icon: Icon, label, value }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "20px 92px 1fr", alignItems: "center", gap: 0.75, minWidth: 0 }}>
      <Icon aria-hidden sx={{ fontSize: 16, color: "var(--sv-muted)" }} />
      <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
        {label}
      </Typography>
      <Typography variant="caption" sx={{ color: "var(--sv-text)", wordBreak: "break-word" }}>
        {value}
      </Typography>
    </Box>
  );
}

// One ticket, in full: number, status, priority, title and its facts, with an Open Ticket button.
function TicketDetailCard({ t, onNavigate }) {
  return (
    <Box component="li" sx={{ listStyle: "none", p: 1.5, bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)", borderRadius: "14px", boxShadow: "var(--sv-card-shadow)" }}>
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2" fontWeight={700} sx={{ color: "var(--sv-accent-ink)", mr: 0.25 }}>
          #{t.ticketNumber}
        </Typography>
        <StatusChip status={t.status} />
        {t.priority && <PriorityChip name={t.priority.name} color={t.priority.color} />}
      </Stack>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 0.75, mb: 1, wordBreak: "break-word", color: "var(--sv-text)", lineHeight: 1.3 }}>
        {t.title}
      </Typography>
      <Stack spacing={0.6}>
        {t.department && <Fact icon={BusinessOutlinedIcon} label="Department" value={t.department} />}
        <Fact icon={PersonOutlineIcon} label="Assigned to" value={t.assignedTo || "Unassigned"} />
        {t.createdAt && <Fact icon={AccessTimeIcon} label="Created" value={day(t.createdAt)} />}
        {t.lastUpdatedAt && <Fact icon={AccessTimeIcon} label="Updated" value={day(t.lastUpdatedAt)} />}
      </Stack>
      <Reason reason={t.reason} />
      <Box
        component="button"
        type="button"
        onClick={() => onNavigate?.(openTarget(t))}
        aria-label={`Open ticket ${t.ticketNumber}`}
        sx={{ mt: 1.25, display: "inline-flex", alignItems: "center", gap: 0.75, font: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer", px: 1.5, py: 0.75, borderRadius: "10px", color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)", border: "1px solid var(--sv-accent-ink)", ...focusRing, ...reducedMotion }}
      >
        <OpenInNewIcon sx={{ fontSize: 16 }} />
        Open Ticket
      </Box>
    </Box>
  );
}

// Several tickets: one compact, pressable row each.
function TicketRow({ t, onNavigate }) {
  return (
    <Box component="li" sx={{ listStyle: "none" }}>
      <Box
        component="button"
        type="button"
        onClick={() => onNavigate?.(openTarget(t))}
        aria-label={`Open ticket ${t.ticketNumber}`}
        sx={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 1,
          textAlign: "left",
          font: "inherit",
          cursor: "pointer",
          p: 1.25,
          color: "var(--sv-text)",
          bgcolor: "var(--sv-surface)",
          border: "1px solid var(--sv-border)",
          borderRadius: "14px",
          boxShadow: "var(--sv-card-shadow)",
          transition: "border-color var(--sv-fast) ease, box-shadow var(--sv-fast) ease",
          "&:hover": { borderColor: "var(--sv-accent-ink)", boxShadow: "var(--sv-card-shadow-hover)" },
          ...focusRing,
          ...reducedMotion,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" fontWeight={700} sx={{ color: "var(--sv-accent-ink)" }}>
              #{t.ticketNumber}
            </Typography>
            <StatusChip status={t.status} />
            {t.priority && <PriorityChip name={t.priority.name} color={t.priority.color} />}
          </Stack>
          <Typography variant="body2" fontWeight={700} sx={{ mt: 0.5, wordBreak: "break-word" }}>
            {t.title}
          </Typography>
          <Typography variant="caption" display="block" sx={{ color: "var(--sv-muted)" }}>
            {[t.department, t.assignedTo ? `Assigned to ${t.assignedTo}` : "Unassigned"].filter(Boolean).join(" · ")}
          </Typography>
          <Reason reason={t.reason} />
        </Box>
        <ChevronRightIcon aria-hidden sx={{ color: "var(--sv-muted)", flexShrink: 0 }} />
      </Box>
    </Box>
  );
}

// Renders the server's restricted ticket-card DTOs. Only fields the server
// already authorized and filtered arrive here; this component never fetches.
export default function TicketListCard({ tickets, total, onNavigate, onSend }) {
  if (!tickets?.length) return null;
  const more = total > tickets.length;
  return (
    <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, mt: 1 }} aria-label="Matching tickets">
      {tickets.length === 1 ? <TicketDetailCard t={tickets[0]} onNavigate={onNavigate} /> : tickets.map((t) => <TicketRow key={t.ticketNumber} t={t} onNavigate={onNavigate} />)}
      {more && (
        <Box component="li" sx={{ listStyle: "none" }}>
          <Box
            component="button"
            type="button"
            onClick={() => onSend?.("Show more")}
            sx={{ width: "100%", display: "flex", alignItems: "center", gap: 1, font: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer", px: 1.5, py: 1, color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)", border: "1px solid transparent", borderRadius: "12px", ...focusRing, ...reducedMotion }}
          >
            <FormatListBulletedIcon sx={{ fontSize: 18 }} />
            <Box component="span" sx={{ flex: 1, textAlign: "left" }}>
              View all {total} tickets (showing {tickets.length})
            </Box>
            <ChevronRightIcon sx={{ fontSize: 18 }} />
          </Box>
        </Box>
      )}
    </Stack>
  );
}
