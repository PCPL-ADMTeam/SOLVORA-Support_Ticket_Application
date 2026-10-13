import { Box, Stack, Typography } from "@mui/material";
import { format } from "date-fns";
import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import EventOutlinedIcon from "@mui/icons-material/EventOutlined";
import UpdateIcon from "@mui/icons-material/Update";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import { focusRing, reducedMotion } from "./theme/chatStyles";
import { StatusChip, PriorityChip } from "./TicketChips";
import { CardFrame, CountBadge } from "./response/parts";

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

// One labelled fact with its icon; a missing value says so in words.
function Fact({ icon: Icon, label, value, missing = "Not recorded" }) {
  return (
    <Box sx={{ display: "flex", gap: 1, minWidth: 0 }}>
      <Icon aria-hidden sx={{ fontSize: 18, mt: 0.25, color: "var(--sv-accent-ink)" }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ display: "block", color: "var(--sv-muted)", lineHeight: 1.3 }}>
          {label}
        </Typography>
        <Typography variant="body2" sx={{ wordBreak: "break-word", fontWeight: value ? 600 : 400, color: value ? "var(--sv-text)" : "var(--sv-muted)" }}>
          {value || missing}
        </Typography>
      </Box>
    </Box>
  );
}

function OpenButton({ t, onNavigate }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={() => onNavigate?.(openTarget(t))}
      aria-label={`Open ticket ${t.ticketNumber}`}
      sx={{ mt: 1.25, display: "inline-flex", alignItems: "center", gap: 0.75, font: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer", px: 1.5, py: 0.75, borderRadius: "10px", color: "var(--sv-on-accent)", background: "var(--sv-accent-gradient)", border: 0, ...focusRing, ...reducedMotion }}
    >
      <OpenInNewIcon sx={{ fontSize: 16 }} />
      Open Ticket
    </Box>
  );
}

// Several tickets: one compact, pressable row each (also used by the What's New card).
export function TicketRow({ t, onNavigate }) {
  const dates = [t.createdAt ? `Created ${day(t.createdAt)}` : null, t.lastUpdatedAt ? `Updated ${day(t.lastUpdatedAt)}` : null].filter(Boolean).join(" · ");
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
          bgcolor: "var(--sv-bg)",
          border: "1px solid var(--sv-border)",
          borderLeft: "4px solid var(--sv-accent-ink)",
          borderRadius: "12px",
          transition: "border-color var(--sv-fast) ease, box-shadow var(--sv-fast) ease",
          "&:hover": { borderColor: "var(--sv-accent-ink)", boxShadow: "var(--sv-card-shadow-hover)" },
          ...focusRing,
          ...reducedMotion,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" fontWeight={800} sx={{ color: "var(--sv-accent-ink)" }}>
              #{t.ticketNumber}
            </Typography>
            <StatusChip status={t.status} />
            {t.priority && <PriorityChip name={t.priority.name} color={t.priority.color} />}
          </Stack>
          <Typography variant="body2" fontWeight={700} sx={{ mt: 0.5, wordBreak: "break-word" }}>
            {t.title}
          </Typography>
          <Typography variant="caption" display="block" sx={{ color: "var(--sv-muted)", wordBreak: "break-word" }}>
            {[t.department, t.assignedTo ? `Assigned to ${t.assignedTo}` : "Unassigned"].filter(Boolean).join(" · ")}
          </Typography>
          {dates && (
            <Typography variant="caption" display="block" sx={{ color: "var(--sv-muted)" }}>
              {dates}
            </Typography>
          )}
          <Reason reason={t.reason} />
        </Box>
        <ChevronRightIcon aria-hidden sx={{ color: "var(--sv-muted)", flexShrink: 0 }} />
      </Box>
    </Box>
  );
}

// What the list is: the filters in force and what a word like "Open" means.
function ListingDetails({ listing }) {
  if (!listing || (!listing.filters?.length && !listing.notes?.length)) return null;
  return (
    <Box sx={{ mb: 1 }}>
      {listing.filters?.length > 0 && (
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap role="group" aria-label="Filters">
          <Typography component="span" variant="caption" sx={{ color: "var(--sv-muted)", mr: 0.25 }}>
            Filters:
          </Typography>
          {listing.filters.map((f) => (
            <Box key={f} component="span" sx={{ px: 1, py: 0.25, borderRadius: 99, fontSize: 12, fontWeight: 700, color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)", maxWidth: "100%", overflowWrap: "anywhere" }}>
              {f}
            </Box>
          ))}
        </Stack>
      )}
      {listing.notes?.map((n) => (
        <Typography key={n} variant="caption" display="block" sx={{ mt: 0.5, color: "var(--sv-muted)" }}>
          {n}
        </Typography>
      ))}
    </Box>
  );
}

// Renders the server's restricted ticket-card DTOs. Only fields the server already authorized and filtered
// arrive here; this component never fetches. One ticket: its details. Several: a titled list.
export default function TicketListCard({ tickets, total, listing, onNavigate, onSend }) {
  if (!tickets?.length) return null;

  if (tickets.length === 1 && !(total > 1)) {
    const t = tickets[0];
    return (
      <CardFrame
        label={`Ticket ${t.ticketNumber}`}
        icon={ConfirmationNumberOutlinedIcon}
        title={`Ticket #${t.ticketNumber}`}
        subtitle={t.title}
        badge={
          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <StatusChip status={t.status} />
            {t.priority && <PriorityChip name={t.priority.name} color={t.priority.color} />}
          </Stack>
        }
      >
        <Box component="ul" aria-label="Matching tickets" sx={{ m: 0, p: 0, listStyle: "none" }}>
          <Box component="li">
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(150px, 100%), 1fr))", gap: 1.25 }}>
              <Fact icon={BusinessOutlinedIcon} label="Department" value={t.department} />
              <Fact icon={AssignmentIndOutlinedIcon} label="Assigned to" value={t.assignedTo} missing="Not assigned yet" />
              {t.raisedBy && <Fact icon={PersonOutlineIcon} label="Raised by" value={t.raisedBy} />}
              <Fact icon={EventOutlinedIcon} label="Created" value={day(t.createdAt)} />
              <Fact icon={UpdateIcon} label="Updated" value={day(t.lastUpdatedAt)} />
            </Box>
            <Reason reason={t.reason} />
            <OpenButton t={t} onNavigate={onNavigate} />
          </Box>
        </Box>
      </CardFrame>
    );
  }

  const more = total > tickets.length;
  return (
    <CardFrame label="Ticket list" icon={FormatListBulletedIcon} title={listing?.title || "Tickets"} subtitle={listing?.showing ? `Showing ${listing.showing}` : `${tickets.length} shown`} badge={<CountBadge>{total ?? tickets.length} {(total ?? tickets.length) === 1 ? "ticket" : "tickets"}</CountBadge>}>
      <ListingDetails listing={listing} />
      <Stack component="ul" spacing={1} sx={{ m: 0, p: 0 }} aria-label="Matching tickets">
        {tickets.map((t) => (
          <TicketRow key={t.ticketNumber} t={t} onNavigate={onNavigate} />
        ))}
        {more && (
          <Box component="li" sx={{ listStyle: "none" }}>
            <Box
              component="button"
              type="button"
              onClick={() => onSend?.("Show more")}
              sx={{ width: "100%", display: "flex", alignItems: "center", gap: 1, font: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer", px: 1.5, py: 1, color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)", border: "1px dashed var(--sv-accent-ink)", borderRadius: "12px", ...focusRing, ...reducedMotion }}
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
    </CardFrame>
  );
}
