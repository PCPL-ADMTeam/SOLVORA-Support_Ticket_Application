import { useEffect, useState, useCallback } from "react";
import {
  IconButton,
  Badge,
  Menu,
  MenuItem,
  Typography,
  Box,
  Divider,
  Button,
  Stack,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import { notificationsApi } from "../../api/notifications";
import { formatDistanceToNow } from "date-fns";
import ConfirmDialog from "../common/ConfirmDialog";

export default function NotificationBell() {
  const [anchorEl, setAnchorEl] = useState(null);
  const [notifications, setNotifications] = useState([]);
  // Server-side total (the list itself is capped at 50 rows), kept in sync
  // optimistically by every read/clear action below so the badge and header
  // update instantly without waiting for the next poll.
  const [unreadCount, setUnreadCount] = useState(0);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  const load = useCallback(async () => {
    try {
      const { data } = await notificationsApi.list();
      setNotifications(data.data);
      setUnreadCount(data.unreadCount ?? data.data.filter((n) => !n.isRead).length);
    } catch {
      /* silently ignore — bell is non-critical */
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000); // poll every minute
    return () => clearInterval(interval);
  }, [load]);

  const handleOpen = (e) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  // Marks only this notification read, flipping its background and the
  // unread count immediately; a failed request is reconciled by load().
  const handleClickNotification = (n) => {
    if (!n.isRead) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      notificationsApi.markRead(n.id).catch(load);
    }
    if (n.ticket) {
      handleClose();
      navigate(`/tickets/${n.ticket.id}`);
    }
  };

  const handleMarkAllRead = async () => {
    const previous = { notifications, unreadCount };
    setNotifications((prev) => prev.map((x) => ({ ...x, isRead: true })));
    setUnreadCount(0);
    try {
      await notificationsApi.markAllRead();
    } catch (err) {
      setNotifications(previous.notifications);
      setUnreadCount(previous.unreadCount);
      enqueueSnackbar(err.response?.data?.message || "Failed to mark notifications as read", { variant: "error" });
    }
  };

  // Distinct from Mark all read: this permanently removes every notification
  // for the current user (the bell then shows the existing empty state)
  // rather than just flipping isRead. Never fires on the click itself — see
  // the confirmation dialog below.
  const handleClearAll = async () => {
    setClearing(true);
    try {
      await notificationsApi.clearAll();
      setClearConfirmOpen(false);
      // Optimistic local clear + a fresh load, same pattern every other
      // action here already uses — if the poll interval fires afterward it
      // will simply reload an (already) empty list, never resurrecting
      // what was just cleared.
      setNotifications([]);
      setUnreadCount(0);
      load();
    } catch (err) {
      // Keep the existing list/unread count untouched on failure — never
      // show a false empty state just because the request failed.
      enqueueSnackbar(err.response?.data?.message || "Failed to clear notifications", { variant: "error" });
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <IconButton color="inherit" onClick={handleOpen}>
        <Badge badgeContent={unreadCount} color="error">
          <NotificationsIcon />
        </Badge>
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        PaperProps={{ sx: { width: 360, maxWidth: "calc(100vw - 32px)" } }}
      >
        <Box sx={{ px: 2, py: 1, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Notifications
            {unreadCount > 0 && (
              <Typography component="span" variant="body2" color="primary" fontWeight={600} sx={{ ml: 0.75 }}>
                ({unreadCount} unread)
              </Typography>
            )}
          </Typography>
          <Stack direction="row" spacing={0.75}>
            {/* Outlined primary — the theme's own button shape/weight, one
                step quieter than the contained Create Ticket button. */}
            <Button
              size="small"
              variant="outlined"
              color="primary"
              disabled={unreadCount === 0}
              onClick={handleMarkAllRead}
              sx={{ px: 1.5, py: 0.25, borderColor: (t) => alpha(t.palette.primary.main, 0.4), "&:hover": { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) } }}
            >
              Mark all read
            </Button>
            {/* Subtle, not error/red-styled — "text.secondary" reads as a
                quieter, secondary action next to "Mark all read" rather than
                a warning, matching the app's existing destructive-action
                pattern (which reserves color="error" for confirm-dialog
                buttons themselves, not the triggering link). */}
            <Button
              size="small"
              color="inherit"
              disabled={notifications.length === 0}
              onClick={() => setClearConfirmOpen(true)}
              sx={{ px: 1.5, py: 0.25, color: "text.secondary", "&:hover": { color: "primary.main", bgcolor: (t) => alpha(t.palette.primary.main, 0.06) } }}
            >
              Clear all
            </Button>
          </Stack>
        </Box>
        <Divider />
        {notifications.length === 0 && (
          <MenuItem disabled>No notifications</MenuItem>
        )}
        {notifications.map((n) => {
          // The backend joins an optional "Department • Priority • Status"
          // details line onto the short message with a single "\n" (see
          // server/src/utils/inAppNotificationContent.js) — split it back
          // out here into its own, slightly more muted line rather than
          // rendering the raw "\n" (which plain text/CSS wouldn't turn into
          // a visible line break on its own).
          const [message, details] = n.message.split("\n");
          return (
            <MenuItem
              key={n.id}
              onClick={() => handleClickNotification(n)}
              // Unread = Solvora's light red tint + primary-red dot on the
              // right; read = plain surface, no dot. Dark mode uses a
              // translucent primary tint so the text stays readable.
              sx={(theme) => {
                const isDark = theme.palette.mode === "dark";
                const bg = n.isRead
                  ? (isDark ? theme.palette.background.paper : "#FFFFFF")
                  : (isDark ? alpha(theme.palette.primary.main, 0.16) : "#FFF1F1");
                return {
                  whiteSpace: "normal",
                  alignItems: "center",
                  gap: 1.5,
                  py: 1.25,
                  bgcolor: bg,
                  borderBottom: 1,
                  borderColor: "divider",
                  "&:last-of-type": { borderBottom: 0 },
                  transition: theme.transitions.create("background-color", { duration: 250 }),
                  "&:hover": { bgcolor: n.isRead ? "action.hover" : (isDark ? alpha(theme.palette.primary.main, 0.24) : "#FFE6E6") },
                };
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  fontWeight={n.isRead ? 500 : 700}
                  sx={{ transition: "font-weight 250ms" }}
                >
                  {/* The dot is decorative (aria-hidden) — screen readers get
                      this visually hidden prefix instead. */}
                  {!n.isRead && (
                    <Box component="span" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
                      Unread:{" "}
                    </Box>
                  )}
                  {n.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">{message}</Typography>
                {details && (
                  <Typography variant="caption" color="text.secondary" display="block">{details}</Typography>
                )}
                <Typography variant="caption" display="block" color="text.disabled">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                </Typography>
              </Box>
              {/* Always mounted so it can fade/shrink out when the item is
                  marked read, rather than vanishing abruptly. */}
              <Box
                aria-hidden
                sx={{
                  width: 8,
                  height: 8,
                  flexShrink: 0,
                  borderRadius: "50%",
                  bgcolor: "primary.main",
                  opacity: n.isRead ? 0 : 1,
                  transform: n.isRead ? "scale(0)" : "scale(1)",
                  transition: "opacity 250ms ease, transform 250ms ease",
                }}
              />
            </MenuItem>
          );
        })}
      </Menu>
      <ConfirmDialog
        open={clearConfirmOpen}
        title="Clear Notifications"
        message="Are you sure you want to clear all notifications? This action will remove all notifications from your notification panel."
        confirmLabel={clearing ? "Clearing..." : "Clear all"}
        danger
        onConfirm={handleClearAll}
        onClose={() => setClearConfirmOpen(false)}
      />
    </>
  );
}
