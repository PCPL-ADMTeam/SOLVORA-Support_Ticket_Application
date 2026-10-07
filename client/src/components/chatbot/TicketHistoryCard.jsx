import { Box, Paper, Typography } from "@mui/material";
import { format } from "date-fns";

export default function TicketHistoryCard({ history }) {
  if (!history?.entries?.length) return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mt: 1, bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)", borderRadius: "14px", color: "var(--sv-text)" }} aria-label={`History of ticket ${history.ticketNumber}`}>
      <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
        {history.entries.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
              {e.description}
            </Typography>
            <Typography sx={{ color: "var(--sv-muted)" }} variant="caption">
              {e.at ? format(new Date(e.at), "MMM d, yyyy h:mm a") : ""}
            </Typography>
          </li>
        ))}
      </Box>
    </Paper>
  );
}
