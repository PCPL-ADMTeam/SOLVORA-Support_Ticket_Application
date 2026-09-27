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
  Chip,
  TextField,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { format } from "date-fns";
import { auditLogsApi } from "../../api/auditLogs";
import LoadingState from "../../components/common/LoadingState";
import PaginationBar from "../../components/common/PaginationBar";
import EmptyState from "../../components/common/EmptyState";
import { ignoreBackdropClick } from "../../utils/dialog";

// Defense-in-depth only — every existing recordAudit() call site already
// passes hand-picked plain fields (name, email, level, color, etc.), never
// a raw user/credential object, so there is no known passwordHash/token
// leakage in real data today. This just guarantees that IF a key that
// looks like a credential ever ends up in oldValues/newValues, the detail
// view still never renders its value.
const SENSITIVE_KEY_PATTERN = /password|passwd|token|secret|apikey|api_key|credential|client_secret/i;

function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "***REDACTED***" : redactSensitive(val),
      ])
    );
  }
  return value;
}

function JsonBlock({ label, value }) {
  if (value === null || value === undefined) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          mt: 0.5,
          p: 1.5,
          bgcolor: "grey.100",
          borderRadius: 1,
          fontSize: 12,
          fontFamily: "monospace",
          overflowX: "auto",
          maxHeight: 260,
          overflowY: "auto",
        }}
      >
        {JSON.stringify(redactSensitive(value), null, 2)}
      </Box>
    </Box>
  );
}

function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={600} sx={{ wordBreak: "break-word" }}>{value}</Typography>
    </Box>
  );
}

export default function AuditLogsPage() {
  const [filters, setFilters] = useState({ page: 1, limit: 20, entityType: "" });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ""));
    const { data } = await auditLogsApi.list(params);
    setResult(data);
    setLoading(false);
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Audit Logs</Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Entity Type"
          placeholder="e.g. User, Ticket, Team"
          value={filters.entityType}
          onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value, page: 1 }))}
        />
      </Stack>

      {loading && <LoadingState />}
      {!loading && result?.data.length === 0 && <EmptyState title="No audit entries found" />}
      {!loading && result?.data.length > 0 && (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>User</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Entity</TableCell>
                <TableCell>Details</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {result.data.map((log) => (
                <TableRow key={log.id} hover onClick={() => setSelectedLog(log)} sx={{ cursor: "pointer" }}>
                  <TableCell>{format(new Date(log.createdAt), "MMM d, yyyy h:mm a")}</TableCell>
                  <TableCell>{log.user?.name || "System"}</TableCell>
                  <TableCell><Chip size="small" label={log.action} /></TableCell>
                  <TableCell>{log.entityType}{log.entityId ? ` #${log.entityId.slice(0, 8)}` : ""}</TableCell>
                  <TableCell sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {log.newValues ? JSON.stringify(log.newValues) : ""}
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

      {/* Detail view — uses the SAME row object GET /audit-logs already
          returned for the list (oldValues/newValues/ipAddress/user are all
          already present, just not rendered in the table), so no extra API
          call or backend change is needed to show the full entry. */}
      <Dialog open={Boolean(selectedLog)} onClose={ignoreBackdropClick(() => setSelectedLog(null))} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Audit Log Details
          <IconButton onClick={() => setSelectedLog(null)} size="small" aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        {selectedLog && (
          <DialogContent dividers>
            <Stack spacing={2}>
              <DetailRow label="Action / Event" value={selectedLog.action} />
              <DetailRow label="User / Actor" value={selectedLog.user?.name || "System"} />
              <DetailRow label="User Email" value={selectedLog.user?.email} />
              <DetailRow label="Timestamp" value={format(new Date(selectedLog.createdAt), "MMM d, yyyy h:mm:ss a")} />
              <DetailRow label="Entity / Resource Type" value={selectedLog.entityType} />
              <DetailRow label="Entity / Resource ID" value={selectedLog.entityId} />
              <DetailRow label="IP Address" value={selectedLog.ipAddress} />

              <Divider />

              <JsonBlock label="Old Values" value={selectedLog.oldValues} />
              <JsonBlock label="New Values" value={selectedLog.newValues} />
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setSelectedLog(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
