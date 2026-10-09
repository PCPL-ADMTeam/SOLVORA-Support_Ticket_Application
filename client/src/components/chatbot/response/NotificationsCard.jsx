import { Box, Stack, Typography } from "@mui/material";
import { format, formatDistanceToNow } from "date-fns";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { CardFrame, CardTitle, EmptyLine } from "./parts";
import { focusRing, reducedMotion } from "../theme/chatStyles";

// "STATUS_CHANGED" -> "Status changed".
const typeLabel = (type) => {
  const s = String(type || "").toLowerCase().replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Notification";
};

function When({ iso }) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (
    <Typography component="time" dateTime={d.toISOString()} title={format(d, "MMM d, yyyy h:mm a")} variant="caption" sx={{ color: "var(--sv-muted)" }}>
      {formatDistanceToNow(d, { addSuffix: true })}
    </Typography>
  );
}

// The user's own notifications: unread first in emphasis, type, ticket, message and time, with an Open
// Ticket button only where the server says the ticket is still visible to them.
export default function NotificationsCard({ notifications, onNavigate }) {
  if (!notifications?.items) return null;
  const { items, unread, shown, matching } = notifications;
  return (
    <CardFrame label="Notifications">
      <CardTitle
        badge={
          <Box component="span" sx={{ px: 1, py: 0.25, borderRadius: 99, fontSize: 12, fontWeight: 700, color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)" }}>
            {unread} unread
          </Box>
        }
      >
        Notifications
      </CardTitle>
      {!items.length ? (
        <EmptyLine>No notifications to show.</EmptyLine>
      ) : (
        <Box component="ul" aria-label="Notification list" sx={{ m: 0, p: 0, display: "grid", gap: 0.75 }}>
          {items.map((n) => (
            <Box
              component="li"
              key={n.id}
              aria-label={`${n.isRead ? "" : "Unread: "}${n.title}`}
              sx={{ listStyle: "none", p: 1.1, borderRadius: "12px", bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)", borderLeft: `4px solid ${n.isRead ? "var(--sv-border)" : "var(--sv-accent-ink)"}` }}
            >
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                <NotificationsNoneIcon aria-hidden sx={{ fontSize: 16, color: "var(--sv-muted)" }} />
                <Typography variant="caption" fontWeight={700} sx={{ color: "var(--sv-muted)" }}>
                  {typeLabel(n.type)}
                </Typography>
                {n.ticketNumber && (
                  <Typography variant="caption" fontWeight={700} sx={{ color: "var(--sv-accent-ink)" }}>
                    #{n.ticketNumber}
                  </Typography>
                )}
                {!n.isRead && (
                  <Box component="span" sx={{ px: 0.75, borderRadius: 99, fontSize: 11, fontWeight: 700, color: "var(--sv-on-accent)", background: "var(--sv-accent-gradient)" }}>
                    Unread
                  </Box>
                )}
              </Stack>
              <Typography variant="body2" fontWeight={n.isRead ? 500 : 700} sx={{ mt: 0.5, wordBreak: "break-word" }}>
                {n.title}
              </Typography>
              {n.message && (
                <Typography variant="body2" sx={{ color: "var(--sv-muted)", wordBreak: "break-word" }}>
                  {n.message}
                </Typography>
              )}
              <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={1} sx={{ mt: 0.5 }}>
                <When iso={n.at} />
                {n.ticketRouteId && (
                  <Box
                    component="button"
                    type="button"
                    onClick={() => onNavigate?.({ type: "route", path: `/tickets/${n.ticketRouteId}`, label: "Open Ticket" })}
                    aria-label={`Open ticket ${n.ticketNumber}`}
                    sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, font: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer", px: 1, py: 0.4, borderRadius: "8px", color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)", border: "1px solid transparent", "&:hover": { borderColor: "var(--sv-accent-ink)" }, ...focusRing, ...reducedMotion }}
                  >
                    <OpenInNewIcon sx={{ fontSize: 14 }} />
                    Open Ticket
                  </Box>
                )}
              </Stack>
            </Box>
          ))}
        </Box>
      )}
      {matching > shown && (
        <Typography variant="caption" display="block" sx={{ mt: 0.75, color: "var(--sv-muted)" }}>
          Showing the latest {shown} of {matching}. The notification bell at the top of the page shows more.
        </Typography>
      )}
    </CardFrame>
  );
}
