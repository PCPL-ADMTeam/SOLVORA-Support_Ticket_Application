import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Paper,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TextField,
  Button,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useSnackbar } from "notistack";
import { prioritiesApi } from "../../api/catalog";
import LoadingState from "../../components/common/LoadingState";
import PriorityBadge from "../../components/common/PriorityBadge";
import DialogCloseButton from "../../components/common/DialogCloseButton";
import { ignoreBackdropClick } from "../../utils/dialog";

const emptyForm = { name: "", level: "", color: "#c81e2a" };

// Priority management only — SLA (response/resolution time) functionality
// has been removed from the system entirely. Existing Priority records
// (Low/Medium/High/Critical), their level, and their use everywhere else
// (ticket creation/filtering/display, dashboard charts) are unaffected.
// Level is edited inline per row and saved with PATCH /priorities/:id —
// the same inline-edit-then-Save pattern this page already used for the
// now-removed SLA minutes, just applied to Priority's own `level` field.
export default function PrioritiesPage() {
  const { enqueueSnackbar } = useSnackbar();
  const [priorities, setPriorities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await prioritiesApi.list();
    setPriorities(data.data);
    const nextEdits = {};
    for (const p of data.data) {
      nextEdits[p.id] = p.level;
    }
    setEdits(nextEdits);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaveLevel = async (priorityId) => {
    try {
      await prioritiesApi.update(priorityId, { level: Number(edits[priorityId]) });
      enqueueSnackbar("Priority updated", { variant: "success" });
      load();
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Save failed", { variant: "error" });
    }
  };

  const handleCreatePriority = async () => {
    try {
      await prioritiesApi.create({ name: form.name, level: Number(form.level), color: form.color });
      setDialogOpen(false);
      setForm(emptyForm);
      load();
      enqueueSnackbar("Priority created", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to create priority", { variant: "error" });
    }
  };

  if (loading) return <LoadingState />;

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h4">Priorities</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>New Priority</Button>
      </Box>

      <Paper variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Priority</TableCell>
              <TableCell>Level</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {priorities.map((p) => (
              <TableRow key={p.id}>
                <TableCell><PriorityBadge name={p.name} color={p.color} /></TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    type="number"
                    value={edits[p.id] ?? ""}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    sx={{ width: 100 }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Button size="small" variant="outlined" onClick={() => handleSaveLevel(p.id)}>Save</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={dialogOpen} onClose={ignoreBackdropClick(() => setDialogOpen(false))}>
        <DialogCloseButton onClose={() => setDialogOpen(false)} />
        <DialogTitle>New Priority</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1, minWidth: 320 }}>
            <TextField label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth />
            <TextField label="Level (1 = lowest)" type="number" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))} fullWidth />
            <TextField label="Color" type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreatePriority}>Create</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
