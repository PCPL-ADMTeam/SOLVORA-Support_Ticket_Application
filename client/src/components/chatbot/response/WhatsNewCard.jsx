import { Box, Stack, Typography } from "@mui/material";
import { formatDistanceToNow } from "date-fns";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { CardAction, CardFrame, CardTitle, EmptyLine, PeriodBadge, Section, StatList, StatRow } from "./parts";
import { TicketRow } from "../TicketListCard";
import { focusRing } from "../theme/chatStyles";

// "today" / "in the last 7 days" / "in Oct 1 – Oct 5, 2026", matching the server's wording.
export function periodPhrase(period) {
  if (!period) return "";
  if (/^(Today|Yesterday|This week|Last week|This month|Last month|This year)$/.test(period.label)) return period.label.toLowerCase();
  if (/^Last \d+ days$/.test(period.label)) return `in the ${period.label.toLowerCase()}`;
  return `in ${period.rangeText}`;
}

const ago = (iso) => {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
};

function TicketCards({ tickets, onNavigate, label }) {
  if (!tickets?.length) return null;
  return (
    <Stack component="ul" spacing={0.75} aria-label={label} sx={{ m: 0, p: 0, mt: 0.75 }}>
      {tickets.map((t) => (
        <TicketRow key={t.ticketNumber} t={t} onNavigate={onNavigate} />
      ))}
    </Stack>
  );
}

function NotificationPeek({ items, onNavigate }) {
  if (!items?.length) return null;
  return (
    <Box component="ul" aria-label="Latest notifications" sx={{ m: 0, mt: 0.75, p: 0, display: "grid", gap: 0.5 }}>
      {items.map((n, i) => (
        <Box component="li" key={`${n.at}-${i}`} sx={{ listStyle: "none", display: "flex", alignItems: "flex-start", gap: 1, p: 1, borderRadius: "10px", bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)" }}>
          <Box aria-hidden sx={{ mt: 0.75, width: 8, height: 8, borderRadius: "50%", flexShrink: 0, bgcolor: n.isRead ? "transparent" : "var(--sv-accent-ink)", border: "1px solid var(--sv-accent-ink)" }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" fontWeight={600} sx={{ wordBreak: "break-word" }}>
              {n.ticketNumber ? `#${n.ticketNumber} · ` : ""}
              {n.title}
              {!n.isRead && (
                <Box component="span" sx={{ ml: 0.75, fontSize: 11, fontWeight: 700, color: "var(--sv-accent-ink)" }}>
                  Unread
                </Box>
              )}
            </Typography>
            <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
              {ago(n.at)}
            </Typography>
          </Box>
          {n.ticketRouteId && (
            <Box
              component="button"
              type="button"
              aria-label={`Open ticket ${n.ticketNumber}`}
              onClick={() => onNavigate?.({ type: "route", path: `/tickets/${n.ticketRouteId}`, label: "Open Ticket" })}
              sx={{ flexShrink: 0, display: "inline-grid", placeItems: "center", width: 30, height: 30, cursor: "pointer", borderRadius: "8px", border: "1px solid var(--sv-border)", bgcolor: "transparent", color: "var(--sv-accent-ink)", ...focusRing }}
            >
              <OpenInNewIcon sx={{ fontSize: 16 }} />
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

// The "What's New" digest: notifications, tickets assigned to you, and your (or your departments')
// tickets, each with its own count, all for the period named in the badge. Only server values are shown.
export default function WhatsNewCard({ digest, onNavigate, onSend, disabled }) {
  if (!digest) return null;
  const { period, notifications, assigned, updated, created, unassigned, caughtUp } = digest;
  const when = periodPhrase(period);
  const inPeriod = `${notifications.inPeriod}${notifications.inPeriodCapped ? "+" : ""}`;

  return (
    <CardFrame label="What's New">
      <CardTitle badge={<PeriodBadge period={period} />}>What&apos;s New</CardTitle>

      {caughtUp ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.25, borderRadius: "10px", bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)" }}>
          <TaskAltIcon aria-hidden sx={{ color: "var(--sv-success)" }} />
          <Box>
            <Typography variant="body2" fontWeight={700}>
              You&apos;re all caught up.
            </Typography>
            <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
              No ticket updates {when} and no unread notifications.
            </Typography>
          </Box>
        </Stack>
      ) : (
        <>
          <Section icon={NotificationsNoneIcon} title="Notifications">
            <StatList label="Notification counts">
              <StatRow label="Unread notifications" hint="(any date)" value={notifications.unread} />
              <StatRow label={`New ${when}`} value={inPeriod} />
            </StatList>
            <NotificationPeek items={notifications.latest} onNavigate={onNavigate} />
            <CardAction icon={NotificationsNoneIcon} onClick={() => onSend?.(notifications.unread ? "Show unread notifications" : "Show my notifications")} disabled={disabled}>
              View Notifications
            </CardAction>
          </Section>

          {assigned && (
            <Section icon={AssignmentIndOutlinedIcon} title="Assigned to You" count={assigned.count}>
              <StatList label="Assigned ticket counts">
                <StatRow label={`Newly assigned or updated ${when}`} value={assigned.count} />
              </StatList>
              {assigned.count === 0 ? <EmptyLine>Nothing new assigned to you {when}.</EmptyLine> : <TicketCards tickets={assigned.tickets} onNavigate={onNavigate} label="Tickets assigned to you" />}
              {assigned.count > (assigned.tickets?.length || 0) && (
                <Typography variant="caption" display="block" sx={{ mt: 0.5, color: "var(--sv-muted)" }}>
                  Showing the {assigned.tickets.length} most recently updated of {assigned.count}.
                </Typography>
              )}
            </Section>
          )}

          <Section icon={ConfirmationNumberOutlinedIcon} title={updated.label} count={updated.count}>
            <StatList label={`${updated.label} counts`}>
              <StatRow label={`Updated ${when}`} value={updated.count} />
              {created !== null && created !== undefined && <StatRow label={`Created ${when}`} value={created} />}
              {unassigned !== null && unassigned !== undefined && <StatRow label="Open with nobody assigned" hint="(right now)" value={unassigned} />}
            </StatList>
            {updated.count === 0 ? (
              <EmptyLine>No ticket updates {when}.</EmptyLine>
            ) : (
              <>
                <TicketCards tickets={updated.tickets} onNavigate={onNavigate} label={`${updated.label} updated`} />
                {(updated.skippedAssigned || updated.count > updated.tickets.length) && (
                  <Typography variant="caption" display="block" sx={{ mt: 0.5, color: "var(--sv-muted)" }}>
                    {updated.tickets.length ? `Showing the ${updated.tickets.length} most recently updated` : "No other tickets to show"}
                    {updated.skippedAssigned ? "; tickets listed under Assigned to You are not repeated" : ""}.
                  </Typography>
                )}
              </>
            )}
          </Section>
        </>
      )}

      {caughtUp && unassigned ? (
        <Typography variant="caption" display="block" sx={{ mt: 1, color: "var(--sv-muted)" }}>
          {unassigned} open ticket{unassigned === 1 ? "" : "s"} still {unassigned === 1 ? "has" : "have"} nobody assigned.
        </Typography>
      ) : null}
    </CardFrame>
  );
}
