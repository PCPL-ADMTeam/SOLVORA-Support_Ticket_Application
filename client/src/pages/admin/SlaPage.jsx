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

// Response/resolution SLA minutes are edited inline per-row and saved with
// PUT /priorities/:id/sla — this is the "SLA configuration per priority"
// requirement (requirement #3.A).
export default function SlaPage() {
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
      nextEdits[p.id] = {
        responseTimeMinutes: p.slaPolicy?.responseTimeMinutes || "",
        resolutionTimeMinutes: p.slaPolicy?.resolutionTimeMinutes || "",
      };
    }
    setEdits(nextEdits);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaveSla = async (priorityId) => {
    try {
      await prioritiesApi.upsertSla(priorityId, {
        responseTimeMinutes: Number(edits[priorityId].responseTimeMinutes),
        resolutionTimeMinutes: Number(edits[priorityId].resolutionTimeMinutes),
      });
      enqueueSnackbar("SLA policy saved", { variant: "success" });
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
        <Typography variant="h4">Priorities & SLA</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>New Priority</Button>
      </Box>

      <Paper variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Priority</TableCell>
              <TableCell>Level</TableCell>
              <TableCell>Response Time (min)</TableCell>
              <TableCell>Resolution Time (min)</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {priorities.map((p) => (
              <TableRow key={p.id}>
                <TableCell><PriorityBadge name={p.name} color={p.color} /></TableCell>
                <TableCell>{p.level}</TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    type="number"
                    value={edits[p.id]?.responseTimeMinutes ?? ""}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: { ...prev[p.id], responseTimeMinutes: e.target.value } }))}
                    sx={{ width: 120 }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    type="number"
                    value={edits[p.id]?.resolutionTimeMinutes ?? ""}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: { ...prev[p.id], resolutionTimeMinutes: e.target.value } }))}
                    sx={{ width: 120 }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Button size="small" variant="outlined" onClick={() => handleSaveSla(p.id)}>Save</Button>
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
