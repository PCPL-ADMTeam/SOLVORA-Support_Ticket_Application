import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  Avatar,
  Stack,
  TextField,
  Button,
  Divider,
  Grid,
  Chip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { format } from "date-fns";
import { useSnackbar } from "notistack";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../api/auth";
import { usersApi } from "../../api/users";
import { ignoreBackdropClick } from "../../utils/dialog";
import FormField from "../common/FormField";

// A single "label / value" row used to lay out the real, existing profile
// fields returned by GET /auth/me — never fabricated placeholders. A field
// is simply omitted (not rendered as "N/A") when the backend has nothing
// for it (e.g. no department, no manager).
function ProfileField({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={600}>{value}</Typography>
    </Box>
  );
}

// Rendered from the top-right user menu ("Profile" / "Edit Profile") in
// place of a dedicated /profile route/page.
export default function ProfileDialog({ open, mode = "view", onClose }) {
  const { user, refreshMe } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const editable = mode === "edit";

  const [name, setName] = useState(user.name);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (open) setName(user.name);
  }, [open, user.name]);

  // The session's `user` (set at login/refresh) doesn't carry a couple of
  // profile-only fields (e.g. departmentManagement) that GET /auth/me adds —
  // re-fetch on open so the panel always reflects the full, current record.
  useEffect(() => {
    if (open) refreshMe().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await usersApi.updateOwnProfile({ name });
      await refreshMe();
      enqueueSnackbar("Profile updated", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Update failed", { variant: "error" });
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      enqueueSnackbar("New passwords do not match", { variant: "error" });
      return;
    }
    setSavingPassword(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      enqueueSnackbar("Password updated", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to update password", { variant: "error" });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Dialog open={open} onClose={ignoreBackdropClick(onClose)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {editable ? "Edit Profile" : "Profile"}
        <IconButton onClick={onClose} size="small" aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
          <Avatar sx={{ width: 64, height: 64, fontSize: 24, bgcolor: "primary.main" }}>{user.name[0]}</Avatar>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>{user.name}</Typography>
            <Typography variant="body2" color="text.secondary">{user.email}</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 0.75, rowGap: 0.5 }}>
              <Chip size="small" variant="outlined" color="primary" label={user.role.label} />
              <Chip size="small" variant="outlined" color={user.isActive ? "success" : "default"} label={user.isActive ? "Active" : "Inactive"} />
            </Stack>
          </Box>
        </Stack>

        {/* Two-column (desktop) / stacked (mobile) view of the real fields
            GET /auth/me already returns — no fabricated placeholders. Kept
            out of edit mode so the edit form stays focused; a user reopens
            in view mode to see this after saving. */}
        {!editable && (
          <Grid container spacing={3} sx={{ mb: 1 }}>
            <Grid item xs={12} sm={6}>
              <Stack spacing={2}>
                <ProfileField label="Department" value={user.department?.name} />
                {/* A Manager can hold several departments at once — `department`
                    (singular) is deliberately null for that role rather than
                    misrepresenting one of several as "the" department (see
                    authService#buildAuthenticatedUser), so this shows the full
                    list instead. Never rendered for a Team Lead/Employee, whose
                    single `department` above already covers it. */}
                {!user.department && user.departmentAccess?.length > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Department Access
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {user.departmentAccess.map((d) => d.name).join(", ")}
                    </Typography>
                  </Box>
                )}
                {user.departmentManagement?.length > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Department Management
                    </Typography>
                    <Stack spacing={0.25}>
                      {user.departmentManagement.map((a) => (
                        <Typography key={a.email} variant="body2" fontWeight={600}>
                          {a.name} ({a.email})
                        </Typography>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Stack>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Stack spacing={2}>
                <ProfileField
                  label="Member Since"
                  value={user.createdAt ? format(new Date(user.createdAt), "MMM d, yyyy") : null}
                />
              </Stack>
            </Grid>
          </Grid>
        )}

        {editable && (
          <>
            <Box component="form" onSubmit={handleProfileSave} sx={{ mb: 3 }}>
              <Stack spacing={2}>
                <TextField label="Full Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
                <Button type="submit" variant="contained" disabled={savingProfile} sx={{ alignSelf: "flex-start" }}>
                  Save Changes
                </Button>
              </Stack>
            </Box>

            <Divider sx={{ mb: 3 }} />

            <Typography variant="subtitle2" fontWeight={700} gutterBottom>Change Password</Typography>
            <Box component="form" onSubmit={handlePasswordChange}>
              <Stack spacing={2}>
                <FormField label="Current Password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />

                {/* Separates the verification step (current password) from the new-password group. */}
                <Divider sx={{ my: 1 }} />

                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
                    Enter at least 8 characters
                  </Typography>
                  <Stack spacing={2}>
                    <FormField label="New Password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
                    <FormField label="Confirm New Password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                  </Stack>
                </Box>
                <Button type="submit" variant="contained" disabled={savingPassword} sx={{ alignSelf: "flex-start" }}>
                  Update Password
                </Button>
              </Stack>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
