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
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import { notificationsApi } from "../../api/notifications";
import { formatDistanceToNow } from "date-fns";
import ConfirmDialog from "../common/ConfirmDialog";

export default function NotificationBell() {
  const [anchorEl, setAnchorEl] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  const load = useCallback(async () => {
    try {
      const { data } = await notificationsApi.list();
      setNotifications(data.data);
    } catch {
      /* silently ignore — bell is non-critical */
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000); // poll every minute
    return () => clearInterval(interval);
  }, [load]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleOpen = (e) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const handleClickNotification = async (n) => {
    if (!n.isRead) await notificationsApi.markRead(n.id);
    handleClose();
    load();
    if (n.ticket) navigate(`/tickets/${n.ticket.id}`);
  };

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllRead();
    load();
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
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose} PaperProps={{ sx: { width: 360 } }}>
        <Box sx={{ px: 2, py: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle1" fontWeight={700}>Notifications</Typography>
          <Stack direction="row" spacing={0.5}>
            <Button size="small" onClick={handleMarkAllRead}>Mark all read</Button>
            {/* Subtle, not error/red-styled — "text.secondary" reads as a
                quieter, secondary action next to "Mark all read" rather than
                a warning, matching the app's existing destructive-action
                pattern (which reserves color="error" for confirm-dialog
                buttons themselves, not the triggering link). */}
            <Button size="small" color="inherit" sx={{ color: "text.secondary" }} onClick={() => setClearConfirmOpen(true)}>
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
              sx={{ whiteSpace: "normal", bgcolor: n.isRead ? "transparent" : "action.hover" }}
            >
              <Box>
                <Typography variant="body2" fontWeight={600}>{n.title}</Typography>
                <Typography variant="caption" color="text.secondary" display="block">{message}</Typography>
                {details && (
                  <Typography variant="caption" color="text.secondary" display="block">{details}</Typography>
                )}
                <Typography variant="caption" display="block" color="text.disabled">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                </Typography>
              </Box>
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
