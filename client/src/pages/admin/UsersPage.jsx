import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Button,
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
  MenuItem,
  Stack,
  FormControlLabel,
  Tooltip,
  Checkbox,
  FormGroup,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import ApartmentIcon from "@mui/icons-material/Apartment";
import { useSnackbar } from "notistack";
import { usersApi } from "../../api/users";
import { departmentsApi } from "../../api/departments";
import { useAuth } from "../../context/AuthContext";
import LoadingState from "../../components/common/LoadingState";
import PaginationBar from "../../components/common/PaginationBar";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import DialogCloseButton from "../../components/common/DialogCloseButton";
import { ignoreBackdropClick } from "../../utils/dialog";

const ROLES = ["ADMIN", "MANAGER", "TEAMLEAD", "EMPLOYEE"];

const emptyForm = { id: null, name: "", email: "", password: "", roleName: "EMPLOYEE", departmentId: "" };

export default function UsersPage() {
  const { enqueueSnackbar } = useSnackbar();
  const { user: currentUser } = useAuth();
  const [filters, setFilters] = useState({ page: 1, limit: 20, search: "", role: "" });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Department Access dialog (MANAGER/TEAMLEAD only) — Admins grant/revoke
  // a given user's UserDepartmentAccess here; the department's own
  // "Managers"/"Team Leads" lists (DepartmentDetailsPage) edit the exact
  // same underlying data from the other direction, same convention as e.g.
  // a group's vs. a user's membership editor.
  const [accessTarget, setAccessTarget] = useState(null);
  const [accessDepartmentIds, setAccessDepartmentIds] = useState([]);
  const [accessLoading, setAccessLoading] = useState(false);

  const loadDepartments = useCallback(async () => {
    const { data } = await departmentsApi.list();
    setDepartments(data.data);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ""));
    const { data } = await usersApi.list(params);
    setResult(data);
    setLoading(false);
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDepartments(); }, [loadDepartments]);

  const openCreate = () => { setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (u) => {
    setForm({
      id: u.id,
      name: u.name,
      email: u.email,
      password: "",
      roleName: u.role.name,
      departmentId: u.departmentId || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      const shared = { departmentId: form.departmentId || null };
      if (form.id) {
        await usersApi.update(form.id, { name: form.name, roleName: form.roleName, ...shared });
      } else {
        await usersApi.create({ name: form.name, email: form.email, password: form.password, roleName: form.roleName, ...shared });
      }
      setDialogOpen(false);
      load();
      enqueueSnackbar("User saved", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Save failed", { variant: "error" });
    }
  };

  const handleDeactivate = async () => {
    try {
      await usersApi.deactivate(deactivateTarget.id);
      setDeactivateTarget(null);
      load();
      enqueueSnackbar("User deactivated", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to deactivate", { variant: "error" });
    }
  };

  // Activating is immediate (no confirmation) — same convention as
  // EmailTemplatesPage's isActive toggle, where only turning something OFF
  // asks for confirmation.
  const handleActivate = async (u) => {
    try {
      await usersApi.activate(u.id);
      load();
      enqueueSnackbar("User activated", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to activate", { variant: "error" });
    }
  };

  const handleDelete = async () => {
    try {
      await usersApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      load();
      enqueueSnackbar("User deleted", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to delete", { variant: "error" });
    }
  };

  const openDepartmentAccess = async (u) => {
    setAccessTarget(u);
    setAccessLoading(true);
    try {
      const { data } = await usersApi.getDepartmentAccess(u.id);
      setAccessDepartmentIds(data.data.map((d) => d.id));
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to load department access", { variant: "error" });
      setAccessTarget(null);
    } finally {
      setAccessLoading(false);
    }
  };

  // A Manager may hold several departments (checkbox multi-select, toggled
  // one at a time); a Team Lead holds exactly one, so selecting a
  // department for them REPLACES the whole array rather than appending —
  // there is never a moment where the draft itself represents more than one
  // department for that role, matching the backend's own
  // "exactly one department for TEAMLEAD" rule.
  const isTeamLeadTarget = accessTarget?.role.name === "TEAMLEAD";
  const toggleAccessDepartment = (departmentId) => {
    if (isTeamLeadTarget) {
      setAccessDepartmentIds([departmentId]);
      return;
    }
    setAccessDepartmentIds((ids) => (
      ids.includes(departmentId) ? ids.filter((id) => id !== departmentId) : [...ids, departmentId]
    ));
  };

  const handleSaveAccess = async () => {
    try {
      await usersApi.replaceDepartmentAccess(accessTarget.id, accessDepartmentIds);
      setAccessTarget(null);
      load();
      loadDepartments();
      enqueueSnackbar("Department access updated", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to save department access", { variant: "error" });
    }
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h4">Users</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New User</Button>
      </Box>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField size="small" label="Search" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))} />
        <TextField size="small" select label="Role" value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value, page: 1 }))} sx={{ minWidth: 140 }}>
          <MenuItem value="">All</MenuItem>
          {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
        </TextField>
      </Stack>

      {loading ? <LoadingState /> : (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {result.data.map((u) => (
                <TableRow key={u.id} hover>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell><Chip size="small" label={u.role.name} /></TableCell>
                  {/* department/departmentAccess are already role-resolved
                      server-side (see user.service.js#attachDepartmentInfo)
                      — a MANAGER's departmentAccess may hold several
                      departments (never truncated to the first one), a
                      TEAMLEAD's holds exactly one, and an EMPLOYEE/ADMIN
                      row's `department` is the existing legacy field,
                      unchanged. */}
                  <TableCell>
                    {u.departmentAccess?.length > 0
                      ? u.departmentAccess.map((d) => d.name).join(", ")
                      : u.department?.name || "—"}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={u.isActive ? "Active" : "Inactive"} color={u.isActive ? "success" : "default"} />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => openEdit(u)} title="Edit"><EditIcon fontSize="small" /></IconButton>
                    {(u.role.name === "MANAGER" || u.role.name === "TEAMLEAD") && (
                      <IconButton size="small" onClick={() => openDepartmentAccess(u)} title="Department Access">
                        <ApartmentIcon fontSize="small" />
                      </IconButton>
                    )}
                    {u.isActive ? (
                      <IconButton size="small" onClick={() => setDeactivateTarget(u)} title="Deactivate"><BlockIcon fontSize="small" /></IconButton>
                    ) : (
                      <IconButton size="small" onClick={() => handleActivate(u)} title="Activate"><CheckCircleOutlineIcon fontSize="small" /></IconButton>
                    )}
                    <Tooltip title={u.id === currentUser.id ? "You cannot delete your own account" : "Delete"}>
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={u.id === currentUser.id}
                          onClick={() => setDeleteTarget(u)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationBar
            pagination={result.pagination}
            onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
            onLimitChange={(limit) => setFilters((f) => ({ ...f, limit, page: 1 }))}
          />
        </Paper>
      )}

      <Dialog open={dialogOpen} onClose={ignoreBackdropClick(() => setDialogOpen(false))} fullWidth maxWidth="sm">
        <DialogCloseButton onClose={() => setDialogOpen(false)} />
        <DialogTitle>{form.id ? "Edit User" : "New User"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth />
            <TextField label="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} fullWidth disabled={Boolean(form.id)} />
            {!form.id && (
              <TextField label="Temporary Password" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} fullWidth helperText="At least 8 characters" />
            )}
            <TextField select label="Role" value={form.roleName} onChange={(e) => setForm((f) => ({ ...f, roleName: e.target.value }))} fullWidth>
              {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </TextField>
            {/* Department membership only applies to an Employee — a
                Manager/Team Lead's department(s) come from the separate
                Department Access control instead (see the icon in the table
                above), and an Admin has no department at all. */}
            {form.roleName === "EMPLOYEE" && (
              <TextField
                select
                label="Department"
                value={form.departmentId}
                onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
                fullWidth
                helperText="The employee's own department, used to auto-fill the ticket form"
              >
                <MenuItem value="">None</MenuItem>
                {departments.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
              </TextField>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(accessTarget)} onClose={ignoreBackdropClick(() => setAccessTarget(null))} fullWidth maxWidth="sm">
        <DialogCloseButton onClose={() => setAccessTarget(null)} />
        <DialogTitle>Department Access — {accessTarget?.name}</DialogTitle>
        <DialogContent>
          {accessLoading ? (
            <LoadingState />
          ) : isTeamLeadTarget ? (
            <Stack spacing={1} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                A Team Lead is assigned to exactly one department. Each department allows a maximum of{" "}
                {departments[0]?.maxTeamLeads ?? 2} Team Leads.
              </Typography>
              <TextField
                select
                size="small"
                label="Department"
                value={accessDepartmentIds[0] || ""}
                onChange={(e) => toggleAccessDepartment(e.target.value)}
                sx={{ mt: 1 }}
              >
                <MenuItem value="">None</MenuItem>
                {departments.map((d) => {
                  const isCurrent = accessDepartmentIds.includes(d.id);
                  const atMax = (d.teamLeads?.length || 0) >= d.maxTeamLeads && !isCurrent;
                  return (
                    <MenuItem key={d.id} value={d.id} disabled={atMax}>
                      {atMax ? `${d.name} (full — ${d.teamLeads.length}/${d.maxTeamLeads} Team Leads)` : d.name}
                    </MenuItem>
                  );
                })}
              </TextField>
            </Stack>
          ) : (
            <Stack spacing={1} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Select the departments this manager can view and manage tickets for. There is no limit on the number
                of departments a Manager may have.
              </Typography>
              <FormGroup>
                {departments.map((d) => {
                  const checked = accessDepartmentIds.includes(d.id);
                  return (
                    <FormControlLabel
                      key={d.id}
                      control={
                        <Checkbox
                          checked={checked}
                          onChange={() => toggleAccessDepartment(d.id)}
                        />
                      }
                      label={d.name}
                    />
                  );
                })}
              </FormGroup>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAccessTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveAccess} disabled={accessLoading}>Save</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        title="Deactivate user?"
        message={`${deactivateTarget?.name} will no longer be able to sign in.`}
        confirmLabel="Deactivate"
        danger
        onClose={() => setDeactivateTarget(null)}
        onConfirm={handleDeactivate}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete user?"
        message={`Are you sure you want to permanently delete this user? "${deleteTarget?.name}" (${deleteTarget?.email}) will be permanently removed from the database. This cannot be undone.`}
        confirmLabel="Delete Permanently"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </Box>
  );
}
