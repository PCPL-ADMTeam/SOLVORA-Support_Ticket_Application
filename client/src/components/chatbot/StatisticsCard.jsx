import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import { statusColor, priorityColor } from "./TicketChips";
import { CardFrame, PeriodBadge, Section, StatList, StatRow, StatTile, TileGrid } from "./response/parts";

const STATUS_LABELS = { OPEN: "Open", IN_PROGRESS: "In Progress", ON_HOLD: "On Hold", RESOLVED: "Resolved", CLOSED: "Closed", REOPENED: "Reopened" };

// Ticket statistics for the user's scope: status tiles (every ticket in scope, whatever its age, so the
// card says "All time"), priorities, then the recent-activity figures, each with its own period in words.
export default function StatisticsCard({ statistics }) {
  if (!statistics) return null;
  return (
    <CardFrame label="Ticket statistics" icon={InsightsOutlinedIcon} title={`${statistics.label} statistics`} subtitle={`${statistics.total} ticket${statistics.total === 1 ? "" : "s"} in total`} badge={<PeriodBadge period="All time" />}>
      <Section title="By status">
        <TileGrid label="Tickets by status">
          {Object.entries(statistics.byStatus).map(([status, count]) => (
            <StatTile key={status} label={STATUS_LABELS[status] || status} value={count} color={statusColor(status)} muted={count === 0} />
          ))}
        </TileGrid>
      </Section>
      {statistics.byPriority?.length > 0 && (
        <Section title="By priority">
          <TileGrid label="Tickets by priority">
            {statistics.byPriority.map((p) => (
              <StatTile key={p.priority} label={`${p.priority} priority`} value={p.count} color={priorityColor(p.priority)} muted={p.count === 0} />
            ))}
          </TileGrid>
        </Section>
      )}
      <Section title="Recent activity">
        <StatList label="Recent activity">
          {typeof statistics.openUnassigned === "number" && <StatRow label="Open with no assignee" value={statistics.openUnassigned} />}
          {typeof statistics.openInactiveOver7Days === "number" && <StatRow label="Open with no update for over 7 days" value={statistics.openInactiveOver7Days} />}
          <StatRow label="Created in the last 7 days" value={statistics.createdLast7Days} />
          <StatRow label="Created in the 7 days before that" value={statistics.createdPrevious7Days} />
          <StatRow label="Created in the last 30 days" value={statistics.createdLast30Days} />
        </StatList>
      </Section>
    </CardFrame>
  );
}
