import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Button,
  Paper,
  Stack,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useSnackbar } from "notistack";
import { departmentsApi } from "../../api/departments";
import { usersApi } from "../../api/users";
import LoadingState from "../../components/common/LoadingState";
import EmptyState from "../../components/common/EmptyState";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import SearchableUserSelector from "../../components/common/SearchableUserSelector";
import DialogCloseButton from "../../components/common/DialogCloseButton";
import { ignoreBackdropClick } from "../../utils/dialog";

// Department = the organizational unit (its Managers — many-to-many, no cap
// — and its Team Leads — many-to-many, up to department.maxTeamLeads, but
// each Team Lead individually holds only ONE department — via
// UserDepartmentAccess, + its EMPLOYEE staff via User.departmentId). "Team
// Members" below is UI terminology only — there is no Team/TeamMember model
// behind it, just department membership managed through the existing user
// APIs.
export default function DepartmentDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [department, setDepartment] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await departmentsApi.list();
    setDepartment(data.data.find((d) => d.id === id) || null);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (!department) return <EmptyState title="Department not found" subtitle="It may have been deleted." />;

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/admin/departments")} sx={{ mb: 1.5 }}>
        Back to Departments
      </Button>

      <Typography variant="h4" sx={{ mb: 2 }}>{department.name}</Typography>

      <Stack spacing={3} sx={{ mt: 2 }}>
        <DepartmentManagersSection department={department} onChanged={load} />
        <DepartmentTeamLeadsSection department={department} onChanged={load} />
        <TeamMembersSection department={department} onChanged={load} />
      </Stack>
    </Box>
  );
}

/* =========================================================
   MANAGERS (UserDepartmentAccess, role=MANAGER — many-to-many, no cap: a
   Manager may span several departments, and a department may have any
   number of Managers)
========================================================= */

function DepartmentManagersSection({ department, onChanged }) {
  const { enqueueSnackbar } = useSnackbar();
  const managersList = department.managers || [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);

  const openDialog = () => {
    setSelected(null);
    setDialogOpen(true);
  };

  const handleAdd = async () => {
    if (!selected) return;
    try {
      await departmentsApi.addManager(department.id, selected.id);
      enqueueSnackbar(`${selected.name} granted access to ${department.name}`, { variant: "success" });
      setDialogOpen(false);
      onChanged();
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to add manager", { variant: "error" });
    }
  };

  const handleRemove = async () => {
    try {
      await departmentsApi.removeManager(department.id, removeTarget.id);
      enqueueSnackbar(`${removeTarget.name} removed from ${department.name}`, { variant: "success" });
      setRemoveTarget(null);
      onChanged();
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to remove manager", { variant: "error" });
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={700}>Managers</Typography>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openDialog}>
          Add Manager
        </Button>
      </Stack>

      {managersList.length === 0 ? (
        <EmptyState title="No managers assigned" subtitle="Add a Manager to oversee this department." />
      ) : (
        <List dense disablePadding>
          {managersList.map((a) => (
            <ListItem key={a.id} divider sx={{ px: 0 }}>
              <ListItemText primary={a.name} secondary={a.email} />
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip size="small" label="MANAGER" />
                <Button size="small" color="error" onClick={() => setRemoveTarget(a)}>Remove Access</Button>
              </Stack>
            </ListItem>
          ))}
        </List>
      )}

      <Dialog open={dialogOpen} onClose={ignoreBackdropClick(() => setDialogOpen(false))} fullWidth maxWidth="xs">
        <DialogCloseButton onClose={() => setDialogOpen(false)} />
        <DialogTitle>Add Manager — {department.name}</DialogTitle>
        <DialogContent>
          {/* Managers may already have OTHER department access — that's not
              a conflict (multi-department is the whole point of the role),
              so nothing here is excluded/disabled beyond Managers already
              in THIS department. */}
          <SearchableUserSelector
            sx={{ mt: 1 }}
            label="Manager"
            placeholder="Search manager by name or email..."
            role="MANAGER"
            excludeIds={managersList.map((a) => a.id)}
            value={selected}
            onChange={setSelected}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!selected} onClick={handleAdd}>Add</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={`Remove ${removeTarget?.name}'s access to ${department.name}?`}
        message="They will immediately lose the ability to view or manage tickets in this department."
        confirmLabel="Remove Access"
        danger
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
      />
    </Paper>
  );
}

/* =========================================================
   TEAM LEADS (UserDepartmentAccess, role=TEAMLEAD — each Team Lead holds
   exactly ONE department; a department may have at most
   department.maxTeamLeads of them, enforced server-side)
========================================================= */

function DepartmentTeamLeadsSection({ department, onChanged }) {
  const { enqueueSnackbar } = useSnackbar();
  const teamLeadsList = department.teamLeads || [];
  const atMax = teamLeadsList.length >= department.maxTeamLeads;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);

  const openDialog = () => {
    setSelected(null);
    setDialogOpen(true);
  };

  // A Team Lead holds exactly one department. One who already manages a
  // DIFFERENT department is shown in search results but DISABLED (see the
  // SearchableUserSelector props below) — the backend
  // (userDepartmentAccessService#setTeamLeadDepartment) independently
  // rejects the request too, so this can never be bypassed by a stale
  // frontend list; an Admin must explicitly remove that other assignment
  // first (that department's own "Remove Access" button) before this
  // person becomes selectable here.
  const handleAdd = async () => {
    if (!selected) return;
    try {
      await departmentsApi.setTeamLead(department.id, selected.id);
      enqueueSnackbar(`${selected.name} assigned as Team Lead of ${department.name}`, { variant: "success" });
      setDialogOpen(false);
      onChanged();
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to assign Team Lead", { variant: "error" });
    }
  };

  const handleRemove = async () => {
    try {
      await departmentsApi.removeTeamLead(department.id, removeTarget.id);
      enqueueSnackbar(`${removeTarget.name} removed from ${department.name}`, { variant: "success" });
      setRemoveTarget(null);
      onChanged();
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to remove Team Lead", { variant: "error" });
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={700}>Team Leads</Typography>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openDialog} disabled={atMax}>
          Add Team Lead
        </Button>
      </Stack>

      {atMax && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          This department has reached the maximum number of Team Leads ({department.maxTeamLeads}). Remove one before adding another.
        </Alert>
      )}

      {teamLeadsList.length === 0 ? (
        <EmptyState title="No Team Leads assigned" subtitle="Add a Team Lead to manage tickets for this department." />
      ) : (
        <List dense disablePadding>
          {teamLeadsList.map((a) => (
            <ListItem key={a.id} divider sx={{ px: 0 }}>
              <ListItemText primary={a.name} secondary={a.email} />
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip size="small" label="TEAM LEAD" />
                <Button size="small" color="error" onClick={() => setRemoveTarget(a)}>Remove Access</Button>
              </Stack>
            </ListItem>
          ))}
        </List>
      )}

      <Dialog open={dialogOpen} onClose={ignoreBackdropClick(() => setDialogOpen(false))} fullWidth maxWidth="xs">
        <DialogCloseButton onClose={() => setDialogOpen(false)} />
        <DialogTitle>Add Team Lead — {department.name}</DialogTitle>
        <DialogContent>
          <SearchableUserSelector
            sx={{ mt: 1 }}
            label="Team Lead"
            placeholder="Search Team Lead by name or email..."
            role="TEAMLEAD"
            excludeIds={teamLeadsList.map((a) => a.id)}
            value={selected}
            onChange={setSelected}
            isOptionDisabled={(option) => option.departmentAccess?.some((d) => d.id !== department.id)}
            getOptionSecondaryText={(option) => {
              const other = option.departmentAccess?.find((d) => d.id !== department.id);
              return other ? `Currently Team Lead — ${other.name}` : null;
            }}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!selected} onClick={handleAdd}>Add</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={`Remove ${removeTarget?.name}'s access to ${department.name}?`}
        message="They will immediately lose the ability to view or manage tickets in this department."
        confirmLabel="Remove Access"
        danger
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
      />
    </Paper>
  );
}

/* =========================================================
   TEAM MEMBERS (= department employees; no Team model involved)
========================================================= */

function TeamMembersSection({ department, onChanged }) {
  const { enqueueSnackbar } = useSnackbar();
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [moveConfirmOpen, setMoveConfirmOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);

  const openAdd = () => {
    setSelected(null);
    setAddOpen(true);
  };

  const applyAdd = async (user) => {
    try {
      await usersApi.update(user.id, { departmentId: department.id });
      enqueueSnackbar(`${user.name} added to ${department.name}`, { variant: "success" });
      setAddOpen(false);
      setMoveConfirmOpen(false);
      onChanged();
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to add employee", { variant: "error" });
    }
  };

  const handleAddSave = () => {
    if (!selected) return;
    if (selected.department) {
      setMoveConfirmOpen(true);
    } else {
      applyAdd(selected);
    }
  };

  const handleRemove = async () => {
    try {
      await usersApi.update(removeTarget.id, { departmentId: null });
      enqueueSnackbar(`${removeTarget.name} removed from ${department.name}`, { variant: "success" });
      setRemoveTarget(null);
      onChanged();
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to remove employee", { variant: "error" });
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={700}>Team Members</Typography>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openAdd}>Add Employee</Button>
      </Stack>

      {department.employees.length === 0 ? (
        <EmptyState title="No employees yet" subtitle="Add EMPLOYEE accounts to this department." />
      ) : (
        <List dense disablePadding>
          {department.employees.map((u) => (
            <ListItem key={u.id} divider sx={{ px: 0 }}>
              <ListItemText primary={u.name} secondary={u.email} />
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip size="small" label="EMPLOYEE" />
                {!u.isActive && <Chip size="small" label="Inactive" />}
                <Button size="small" color="error" onClick={() => setRemoveTarget(u)}>Remove</Button>
              </Stack>
            </ListItem>
          ))}
        </List>
      )}

      <Dialog open={addOpen} onClose={ignoreBackdropClick(() => setAddOpen(false))} fullWidth maxWidth="xs">
        <DialogCloseButton onClose={() => setAddOpen(false)} />
        <DialogTitle>Add Employee to {department.name}</DialogTitle>
        <DialogContent>
          <SearchableUserSelector
            sx={{ mt: 1 }}
            label="Employee"
            placeholder="Search employee name or email..."
            role="EMPLOYEE"
            excludeIds={department.employees.map((u) => u.id)}
            value={selected}
            onChange={setSelected}
            getOptionSecondaryText={(option) => (
              option.department && option.department.id !== department.id
                ? `Currently in ${option.department.name}`
                : null
            )}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!selected} onClick={handleAddSave}>Add</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={moveConfirmOpen}
        title="Move employee?"
        message={selected ? `${selected.name} currently belongs to ${selected.department?.name || "another department"}. Move them to ${department.name}?` : ""}
        confirmLabel="Move"
        onClose={() => setMoveConfirmOpen(false)}
        onConfirm={() => applyAdd(selected)}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={`Remove ${removeTarget?.name} from ${department.name}?`}
        message="This only clears their department assignment — the user account itself is not deleted."
        confirmLabel="Remove"
        danger
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
      />
    </Paper>
  );
}
