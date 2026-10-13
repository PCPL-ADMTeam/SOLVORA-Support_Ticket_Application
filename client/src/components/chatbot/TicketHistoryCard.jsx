import { Box, Typography } from "@mui/material";
import { format } from "date-fns";
import HistoryIcon from "@mui/icons-material/History";
import { CardFrame, CountBadge } from "./response/parts";

const at = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? format(d, "MMM d, yyyy, h:mm a") : "";
};

// A ticket's recorded history as a timeline, newest first (as the server lists it). Text only.
export default function TicketHistoryCard({ history }) {
  if (!history?.entries?.length) return null;
  return (
    <CardFrame label={`History of ticket ${history.ticketNumber}`} icon={HistoryIcon} title={`History of ticket #${history.ticketNumber}`} subtitle="What happened to the ticket, newest first" badge={<CountBadge>{history.entries.length} events</CountBadge>}>
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: "none" }}>
        {history.entries.map((e, i) => (
          <Box component="li" key={`${e.at}-${i}`} sx={{ position: "relative", pl: 2.75, pb: i === history.entries.length - 1 ? 0 : 1.25 }}>
            {/* The dot and the line of the timeline. */}
            <Box aria-hidden sx={{ position: "absolute", left: 4, top: 6, width: 10, height: 10, borderRadius: "50%", bgcolor: i === 0 ? "var(--sv-accent-ink)" : "var(--sv-surface)", border: "2px solid var(--sv-accent-ink)" }} />
            {i < history.entries.length - 1 && <Box aria-hidden sx={{ position: "absolute", left: 8, top: 18, bottom: 0, width: 2, bgcolor: "var(--sv-border)" }} />}
            <Typography variant="body2" sx={{ wordBreak: "break-word", fontWeight: i === 0 ? 700 : 500 }}>
              {e.description}
            </Typography>
            <Typography sx={{ color: "var(--sv-muted)" }} variant="caption">
              {at(e.at)}
            </Typography>
          </Box>
        ))}
      </Box>
    </CardFrame>
  );
}
