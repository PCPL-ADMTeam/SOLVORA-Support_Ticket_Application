import { Box, Typography, Paper, Stack, List, ListItemButton, ListItemText, Divider, Alert } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

// Lightweight settings hub — the actual configurable resources
// (priorities, teams, users) each have their own dedicated admin page; this
// page is the index plus system-level info that isn't editable from the UI
// (mail/JWT config lives in server/.env by design).
export default function SettingsPage() {
  return (
    <Box maxWidth={640}>
      <Typography variant="h4" gutterBottom>Settings</Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>Configuration</Typography>
        <List disablePadding>
          <ListItemButton component={RouterLink} to="/admin/priorities">
            <ListItemText primary="Priorities" secondary="Manage ticket priority levels" />
          </ListItemButton>
          <Divider component="li" />
          <ListItemButton component={RouterLink} to="/admin/teams">
            <ListItemText primary="Teams / Groups" secondary="Group agents for ticket routing" />
          </ListItemButton>
          <Divider component="li" />
          <ListItemButton component={RouterLink} to="/admin/users">
            <ListItemText primary="Users & Roles" secondary="Manage accounts, roles, and team membership" />
          </ListItemButton>
        </List>
      </Paper>

      <Alert severity="info">
        Email (SMTP) and authentication (JWT secret/expiry) settings are environment-level
        configuration for security reasons and are set in <code>server/.env</code> — see the
        project README for details.
      </Alert>
    </Box>
  );
}
