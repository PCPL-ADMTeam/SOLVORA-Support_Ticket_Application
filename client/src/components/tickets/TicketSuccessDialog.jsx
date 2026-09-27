import {
  Dialog,
  Box,
  Typography,
  Button,
  Stack,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DialogCloseButton from "../common/DialogCloseButton";
import { ignoreBackdropClick } from "../../utils/dialog";

export default function TicketSuccessDialog({
  open,
  onClose,
  onViewTicket,
  ticketId,
  department,
}) {
  return (
    <Dialog
      open={open}
      onClose={ignoreBackdropClick(onClose)}
      maxWidth="xs"
      fullWidth
      slotProps={{
        backdrop: {
          sx: {
            backdropFilter: "blur(6px)",
            backgroundColor: "rgba(15, 23, 42, 0.35)",
          },
        },
      }}
      PaperProps={{
        sx: {
          borderRadius: 4,
          p: 1,
        },
      }}
    >
      <DialogCloseButton onClose={onClose} />
      <Box
        sx={{
          px: 3,
          py: 4,
          textAlign: "center",
        }}
      >
        <CheckCircleIcon
          sx={{
            fontSize: 56,
            color: "success.main",
            mb: 1.5,
          }}
        />

        <Typography
          sx={{
            fontSize: 18,
            fontWeight: 700,
            color: "text.primary",
          }}
        >
          Ticket Raised Successfully
        </Typography>

        <Typography
          sx={{
            mt: 1,
            fontSize: 14,
            color: "text.secondary",
          }}
        >
          {ticketId && department
            ? `Your ticket #${ticketId} has been raised to the ${department}.`
            : "Your ticket has been submitted. Our support team will get back to you shortly."}
        </Typography>

        <Stack
          direction="row"
          spacing={1.5}
          justifyContent="center"
          sx={{ mt: 3 }}
        >
          <Button
            variant="outlined"
            onClick={onClose}
            sx={{
              textTransform: "none",
              borderRadius: 2,
              px: 3,
            }}
          >
            Close
          </Button>

          <Button
            variant="contained"
            onClick={onViewTicket}
            sx={{
              textTransform: "none",
              borderRadius: 2,
              px: 3,
            }}
          >
            View Ticket
          </Button>
        </Stack>
      </Box>
    </Dialog>
  );
}
