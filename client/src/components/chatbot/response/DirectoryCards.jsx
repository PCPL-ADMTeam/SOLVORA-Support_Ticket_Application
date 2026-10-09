import { Box, Stack, Typography } from "@mui/material";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import { CardFrame, CardTitle, EmptyLine, PeriodBadge, Section, StatList, StatRow, StatTile, TileGrid } from "./parts";

// People and department answers. They show only what the server sent, which is already limited to the
// user's own scope: names, roles and counts. Never emails, ids or contact details.

const initial = (name) => String(name || "?").trim().charAt(0).toUpperCase();

function RolePill({ role }) {
  return (
    <Box component="span" sx={{ flexShrink: 0, px: 0.9, py: 0.15, borderRadius: 99, fontSize: 11.5, fontWeight: 700, color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)" }}>
      {role}
    </Box>
  );
}

function PersonRow({ name, role, note }) {
  return (
    <Box component="li" sx={{ listStyle: "none", display: "flex", alignItems: "center", gap: 1, py: 0.5, minWidth: 0 }}>
      <Box aria-hidden sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)" }}>
        {initial(name)}
      </Box>
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
        {name}
        {note && (
          <Typography component="span" variant="caption" sx={{ ml: 0.5, color: "var(--sv-muted)" }}>
            {note}
          </Typography>
        )}
      </Typography>
      {role && <RolePill role={role} />}
    </Box>
  );
}

// "People in IT Support": one section per department with its members (or just the count).
export function PeopleCard({ departments }) {
  if (!departments?.length) return null;
  return (
    <CardFrame label="People">
      {departments.map((d) => (
        <Section key={d.name} icon={GroupsOutlinedIcon} title={d.name} count={d.total}>
          {!d.members ? null : d.members.length === 0 ? (
            <EmptyLine>No people found.</EmptyLine>
          ) : (
            <Box component="ul" aria-label={`People in ${d.name}`} sx={{ m: 0, p: 0 }}>
              {d.members.map((m) => (
                <PersonRow key={`${m.role}:${m.name}`} name={m.name} role={m.role} />
              ))}
              {d.total > d.members.length && (
                <Typography component="li" variant="caption" sx={{ listStyle: "none", color: "var(--sv-muted)" }}>
                  …and {d.total - d.members.length} more
                </Typography>
              )}
            </Box>
          )}
        </Section>
      ))}
    </CardFrame>
  );
}

// One person: name, role, department(s), and whether the account is active.
export function PersonCard({ person }) {
  if (!person) return null;
  const departments = person.departments || (person.department ? [person.department] : []);
  return (
    <CardFrame label={`About ${person.name}`}>
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Box aria-hidden sx={{ width: 40, height: 40, flexShrink: 0, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 16, fontWeight: 800, color: "var(--sv-on-accent)", background: "var(--sv-accent-gradient)" }}>
          {initial(person.name)}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={800} sx={{ wordBreak: "break-word" }}>
            {person.name}
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
            {person.role && <RolePill role={person.role} />}
            {person.active === false && (
              <Typography component="span" variant="caption" sx={{ color: "var(--sv-error)", fontWeight: 700 }}>
                Deactivated
              </Typography>
            )}
          </Stack>
        </Box>
      </Stack>
      <StatList label="Details">
        <StatRow label="Department" value={departments.length ? departments.join(", ") : "Not recorded"} />
      </StatList>
    </CardFrame>
  );
}

// The departments the user may ask about.
export function DepartmentListCard({ departments }) {
  if (!departments?.length) return null;
  return (
    <CardFrame label="Departments">
      <Box component="ul" aria-label="Departments" sx={{ m: 0, p: 0, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {departments.map((d) => (
          <Box component="li" key={d} sx={{ listStyle: "none", display: "inline-flex", alignItems: "center", gap: 0.5, px: 1.1, py: 0.5, borderRadius: 99, bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)", fontSize: 13.5, fontWeight: 600, maxWidth: "100%", overflowWrap: "anywhere" }}>
            <BusinessOutlinedIcon aria-hidden sx={{ fontSize: 16, color: "var(--sv-accent-ink)" }} />
            {d}
          </Box>
        ))}
      </Box>
    </CardFrame>
  );
}

// Per-department counts: headcount, tickets by department, Manager / Team Lead assignments.
export function DepartmentStatsCard({ headcount, ticketsByDepartment, assignments }) {
  if (headcount?.length) {
    return (
      <CardFrame label="People by department">
        {headcount.map((d) => (
          <Section key={d.name} icon={BusinessOutlinedIcon} title={d.name}>
            <StatList label={`${d.name} headcount`}>
              <StatRow label="Employees" value={d.employees} />
              <StatRow label="Team leads" value={d.teamLeads} />
              <StatRow label="Managers" value={d.managers} />
            </StatList>
          </Section>
        ))}
      </CardFrame>
    );
  }
  if (ticketsByDepartment?.length) {
    return (
      <CardFrame label="Tickets by department">
        <CardTitle badge={<PeriodBadge period="All time" />}>Tickets by department</CardTitle>
        {ticketsByDepartment.map((d) => (
          <Section key={d.name} icon={BusinessOutlinedIcon} title={d.name} count={d.total}>
            <StatList label={`${d.name} tickets`}>
              <StatRow label="Total tickets" value={d.total} />
              <StatRow label="Open" hint="(Open, In Progress, On Hold, Reopened)" value={d.open} />
            </StatList>
          </Section>
        ))}
      </CardFrame>
    );
  }
  if (assignments?.length) {
    return (
      <CardFrame label="Manager and Team Lead assignments">
        {assignments.map((d) => (
          <Section key={d.name} icon={BusinessOutlinedIcon} title={d.name}>
            <Box component="ul" aria-label={`${d.name} managers and team leads`} sx={{ m: 0, p: 0 }}>
              {d.managers.map((n) => (
                <PersonRow key={`m:${n}`} name={n} role="Manager" />
              ))}
              {d.teamLeads.map((n) => (
                <PersonRow key={`t:${n}`} name={n} role="Team Lead" />
              ))}
              {!d.managers.length && !d.teamLeads.length && <EmptyLine>No Manager or Team Lead assigned.</EmptyLine>}
            </Box>
          </Section>
        ))}
      </CardFrame>
    );
  }
  return null;
}

// Active users by role.
export function RoleCountsCard({ roles }) {
  if (!roles?.length) return null;
  return (
    <CardFrame label="Users by role">
      <TileGrid label="Active users by role">
        {roles.map((r) => (
          <StatTile key={r.role} label={r.role} value={r.count} muted={r.count === 0} />
        ))}
      </TileGrid>
    </CardFrame>
  );
}

// The weekly report: what happened in the last 7 days, and where things stand now.
export function WeeklyReportCard({ report }) {
  if (!report) return null;
  const fmt = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <CardFrame label="Weekly ticket report">
      <CardTitle badge={<PeriodBadge period={{ label: "Last 7 days", rangeText: `${fmt(report.from)} – ${fmt(report.to)}` }} />}>Weekly ticket report</CardTitle>
      <TileGrid label="Last 7 days">
        <StatTile label="Created" value={report.created} />
        <StatTile label="Resolved" value={report.resolved} />
        <StatTile label="Closed" value={report.closed} />
        <StatTile label="Open now" value={report.openNow} />
      </TileGrid>
      {report.createdByDepartment?.length > 0 && (
        <Section title="Created, by department">
          <StatList label="Created by department">
            {report.createdByDepartment.map((d) => (
              <StatRow key={d.name} label={d.name} value={d.count} />
            ))}
          </StatList>
        </Section>
      )}
      {report.createdByPriority?.length > 0 && (
        <Section title="Created, by priority">
          <StatList label="Created by priority">
            {report.createdByPriority.map((p) => (
              <StatRow key={p.name} label={p.name} value={p.count} />
            ))}
          </StatList>
        </Section>
      )}
    </CardFrame>
  );
}
