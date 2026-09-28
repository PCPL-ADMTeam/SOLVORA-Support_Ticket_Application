import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Button,
  Grid,
  Card,
  CardActionArea,
  CardContent,
  CardActions,
  Chip,
  Stack,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useSnackbar } from "notistack";
import { departmentsApi } from "../../api/departments";
import LoadingState from "../../components/common/LoadingState";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import DialogCloseButton from "../../components/common/DialogCloseButton";
import { ignoreBackdropClick } from "../../utils/dialog";

const emptyDeptForm = { id: null, name: "" };

// Card-grid overview of every department — click through to
// DepartmentDetailsPage for agent / team members / issue management.
export default function DepartmentsPage() {
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);

  const [deptDialogOpen, setDeptDialogOpen] = useState(false);
  const [deptForm, setDeptForm] = useState(emptyDeptForm);
  const [deptDeleteTarget, setDeptDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await departmentsApi.list();
    setDepartments(data.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreateDept = () => { setDeptForm(emptyDeptForm); setDeptDialogOpen(true); };
  const openEditDept = (d) => { setDeptForm({ id: d.id, name: d.name }); setDeptDialogOpen(true); };

  const handleSaveDept = async () => {
    try {
      if (deptForm.id) {
        await departmentsApi.update(deptForm.id, { name: deptForm.name });
      } else {
        await departmentsApi.create({ name: deptForm.name });
      }
      setDeptDialogOpen(false);
      load();
      enqueueSnackbar("Department saved", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Save failed", { variant: "error" });
    }
  };

  const handleDeleteDept = async () => {
    try {
      await departmentsApi.remove(deptDeleteTarget.id);
      setDeptDeleteTarget(null);
      load();
      enqueueSnackbar("Department deleted", { variant: "success" });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || "Failed to delete", { variant: "error" });
    }
  };

  if (loading) return <LoadingState />;

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h4">Departments</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateDept}>New Department</Button>
      </Box>

      <Grid container spacing={2}>
        {departments.map((d) => {
          const managers = d.managers || [];
          const teamLeads = d.teamLeads || [];
          return (
            <Grid item xs={12} sm={6} md={4} key={d.id}>
              <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                <CardActionArea onClick={() => navigate(`/admin/departments/${d.id}`)} sx={{ flexGrow: 1, alignItems: "stretch" }}>
                  <CardContent>
                    <Typography variant="h6" fontWeight={700}>{d.name}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {teamLeads.length
                        ? `Team Leads: ${teamLeads.map((a) => a.name).join(", ")}`
                        : "No Team Leads assigned"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {managers.length
                        ? `Managers: ${managers.map((a) => a.name).join(", ")}`
                        : "No Managers assigned"}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                      <Chip size="small" label={`${d.employees.length} Employee${d.employees.length === 1 ? "" : "s"}`} />
                    </Stack>
                  </CardContent>
                </CardActionArea>
                <CardActions sx={{ justifyContent: "space-between", px: 2, pb: 1.5 }}>
                  <Button size="small" onClick={() => navigate(`/admin/departments/${d.id}`)}>View Details</Button>
                  <Stack direction="row">
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); openEditDept(d); }}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); setDeptDeleteTarget(d); }}><DeleteIcon fontSize="small" /></IconButton>
                  </Stack>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Dialog open={deptDialogOpen} onClose={ignoreBackdropClick(() => setDeptDialogOpen(false))} fullWidth maxWidth="sm">
        <DialogCloseButton onClose={() => setDeptDialogOpen(false)} />
        <DialogTitle>{deptForm.id ? "Edit Department" : "New Department"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Name"
              value={deptForm.name}
              onChange={(e) => setDeptForm((f) => ({ ...f, name: e.target.value }))}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeptDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveDept}>Save</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deptDeleteTarget)}
        title="Delete department?"
        message={`"${deptDeleteTarget?.name}" will be permanently removed. This fails if any tickets or users reference it.`}
        confirmLabel="Delete"
        danger
        onClose={() => setDeptDeleteTarget(null)}
        onConfirm={handleDeleteDept}
      />
    </Box>
  );
}
