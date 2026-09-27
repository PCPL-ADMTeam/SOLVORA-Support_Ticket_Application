import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  CardActions,
  IconButton,
  Chip,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import { useSnackbar } from "notistack";
import { teamsApi } from "../../api/teams";
import LoadingState from "../../components/common/LoadingState";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import DialogCloseButton from "../../components/common/DialogCloseButton";
import { ignoreBackdropClick } from "../../utils/dialog";
import SearchableUserSelector from "../../components/common/SearchableUserSelector";

const emptyForm = { id: null, name: "", description: "", members: [] };

export default function TeamsPage() {
  const { enqueueSnackbar } = useSnackbar();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await teamsApi.list();
    setTeams(data.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (t) => {
    // Existing members are already returned in full (id/name/email) by
    // GET /teams — hydrated straight from there rather than needing a
    // separate eager fetch of the whole user table just to resolve names.
    setForm({ id: t.id, name: t.name, description: t.description || "", members: t.members.map((m) => m.user) });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      const memberIds = form.members.map((u) => u.id);
      if (form.id) {
        await teamsApi.update(form.id, { name: form.name, description: form.description, memberIds });
      } else {
        await teamsApi.create({ name: form.name, description: form.description, memberIds });
      }
      setDialogOpen(false);
      load();
      enqueueSnackbar("Team saved", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Save failed", { variant: "error" });
    }
  };

  const handleDelete = async () => {
    try {
      await teamsApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      load();
      enqueueSnackbar("Team deleted", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Delete failed", { variant: "error" });
    }
  };

  if (loading) return <LoadingState />;

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h4">Teams / Groups</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Team</Button>
      </Box>

      <Grid container spacing={2}>
        {teams.map((t) => (
          <Grid item xs={12} sm={6} md={4} key={t.id}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6">{t.name}</Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>{t.description || "No description"}</Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                  {t.members.map((m) => <Chip key={m.user.id} size="small" label={m.user.name} />)}
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  {t._count.tickets} ticket(s)
                </Typography>
              </CardContent>
              <CardActions>
                <IconButton size="small" onClick={() => openEdit(t)}><EditIcon fontSize="small" /></IconButton>
                <IconButton size="small" onClick={() => setDeleteTarget(t)}><DeleteIcon fontSize="small" /></IconButton>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Dialog open={dialogOpen} onClose={ignoreBackdropClick(() => setDialogOpen(false))} fullWidth maxWidth="sm">
        <DialogCloseButton onClose={() => setDialogOpen(false)} />
        <DialogTitle>{form.id ? "Edit Team" : "New Team"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth />
            <TextField label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} fullWidth multiline minRows={2} />
            <SearchableUserSelector
              multiple
              label="Members"
              placeholder="Search name or email..."
              value={form.members}
              onChange={(value) => setForm((f) => ({ ...f, members: value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>Save</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete team?"
        message={`This will remove "${deleteTarget?.name}" and unassign its tickets from this team.`}
        confirmLabel="Delete"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </Box>
  );
}
