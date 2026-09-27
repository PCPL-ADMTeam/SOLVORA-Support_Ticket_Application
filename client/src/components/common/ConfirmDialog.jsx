import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from "@mui/material";
import DialogCloseButton from "./DialogCloseButton";
import { ignoreBackdropClick } from "../../utils/dialog";

export default function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", danger, onConfirm, onClose }) {
  return (
    <Dialog open={open} onClose={ignoreBackdropClick(onClose)}>
      <DialogCloseButton onClose={onClose} />
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onConfirm} color={danger ? "error" : "primary"} variant="contained">
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
