import { Box, Typography } from "@mui/material";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import FlagOutlinedIcon from "@mui/icons-material/FlagOutlined";
import { CardFrame, CardTitle, PeriodBadge, Section, StatTile, TileGrid } from "./parts";
import { priorityColor, statusColor } from "../TicketChips";

const ICONS = { created: UploadFileOutlinedIcon, assigned: AssignmentIndOutlinedIcon };

// "Your Ticket Summary": one section per dashboard tab (Raised by you / Assigned to you), each with its
// total and the status counts the dashboard service returned, then the priority counts kept per tab so
// the two are never added together. Zero is shown as 0, not hidden.
export default function SummaryReportCard({ report }) {
  if (!report?.sections?.length) return null;
  const withPriorities = report.sections.filter((s) => s.byPriority?.length);
  return (
    <CardFrame label={report.title || "Ticket summary"}>
      <CardTitle badge={<PeriodBadge period={report.period} />}>{report.title || "Ticket summary"}</CardTitle>
      {report.sections.map((s) => (
        <Section key={s.key} icon={ICONS[s.key]} title={s.label} count={s.total}>
          {s.total === 0 ? (
            <Typography variant="body2" sx={{ color: "var(--sv-muted)" }}>
              No tickets in this period.
            </Typography>
          ) : (
            <TileGrid label={`${s.label} by status`}>
              {s.byStatus.map((st) => (
                <StatTile key={st.status} label={st.label} value={st.count} color={statusColor(st.status)} muted={st.count === 0} />
              ))}
            </TileGrid>
          )}
        </Section>
      ))}
      {withPriorities.length > 0 && (
        <Section icon={FlagOutlinedIcon} title="Priority Breakdown">
          {withPriorities.map((s) => (
            <Box key={s.key} sx={{ mt: 0.5 }}>
              {withPriorities.length > 1 && (
                <Typography variant="caption" sx={{ color: "var(--sv-muted)", fontWeight: 700 }}>
                  {s.label}
                </Typography>
              )}
              <Box component="ul" aria-label={`${s.label} by priority`} sx={{ m: 0, mt: 0.25, p: 0, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                {s.byPriority.map((p) => (
                  <Box component="li" key={p.priority} sx={{ listStyle: "none", display: "inline-flex", alignItems: "center", gap: 0.75, px: 1, py: 0.35, borderRadius: 99, border: "1px solid var(--sv-border)", bgcolor: "var(--sv-surface)", fontSize: 13 }}>
                    <Box aria-hidden component="span" sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: priorityColor(p.priority) }} />
                    <span>{p.priority}</span>
                    <Box component="span" sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                      {p.count}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Section>
      )}
    </CardFrame>
  );
}
