import { Box, Stack, Typography } from "@mui/material";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import BadgeOutlinedIcon from "@mui/icons-material/BadgeOutlined";
import SupervisorAccountOutlinedIcon from "@mui/icons-material/SupervisorAccountOutlined";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import { CardFrame, CountBadge, EmptyLine, PeriodBadge, Section, StatList, StatRow, StatTile, TileGrid } from "./parts";

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
    <CardFrame label="People" icon={GroupsOutlinedIcon} title={departments.length === 1 ? `People in ${departments[0].name}` : "People by department"} subtitle="Names and roles only" badge={<CountBadge>{departments.reduce((n, d) => n + (d.total || 0), 0)}</CountBadge>}>
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

// A numbered person row: S.No., name, role and department (the department under the name, so it fits a phone).
function NumberedPerson({ index, name, role, department }) {
  return (
    <Box component="li" sx={{ listStyle: "none", display: "flex", alignItems: "center", gap: 1, py: 0.6, borderTop: index > 1 ? "1px solid var(--sv-border)" : 0, minWidth: 0 }}>
      <Typography component="span" variant="caption" sx={{ width: 22, flexShrink: 0, textAlign: "right", color: "var(--sv-muted)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {index}.
      </Typography>
      <Box aria-hidden sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)" }}>
        {initial(name)}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} sx={{ wordBreak: "break-word" }}>
          {name}
        </Typography>
        {department && (
          <Typography variant="caption" sx={{ display: "block", color: "var(--sv-muted)" }}>
            {department}
          </Typography>
        )}
      </Box>
      {role && <RolePill role={role} />}
    </Box>
  );
}

const ROLE_KEYS = [
  ["MANAGER", "Managers"],
  ["TEAMLEAD", "Team Leads"],
  ["EMPLOYEE", "Employees"],
];

// "Managers 1 · Team Leads 1 · Employees 2": the exact count per role, when more than one role is in the answer.
function RoleCounts({ counts }) {
  const shown = ROLE_KEYS.filter(([k]) => counts && counts[k] !== undefined);
  if (shown.length < 2) return null;
  return (
    <Box component="ul" aria-label="Count by role" sx={{ m: 0, mt: 0.5, p: 0, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
      {shown.map(([k, label]) => (
        <Box component="li" key={k} sx={{ listStyle: "none", px: 0.9, py: 0.2, borderRadius: 99, fontSize: 12, border: "1px solid var(--sv-border)", bgcolor: "var(--sv-bg)" }}>
          {label} <strong>{counts[k]}</strong>
        </Box>
      ))}
    </Box>
  );
}

// The answer to a people question: who and/or how many, for the role(s) and department(s) asked about. The count
// and the names come from the same server-side filter, so they always agree; a shortened list says so.
export function PeopleResultCard({ people }) {
  if (!people) return null;
  const names = people.mode !== "count";
  const single = people.departments.length === 1 && people.scope === "named";
  const admins = people.admins;
  return (
    <CardFrame
      label={people.title}
      icon={people.roles?.length === 1 && people.roles[0] === "Administrators" ? BadgeOutlinedIcon : GroupsOutlinedIcon}
      title={people.title}
      subtitle={`Total ${people.noun || "people"}: ${people.total}${people.scope === "every" && people.departments.length > 1 ? ` · ${people.departments.length} departments` : ""}`}
      badge={<CountBadge>{people.total}</CountBadge>}
    >
      {people.total === 0 && !admins?.total && <EmptyLine>No matching people were found. Total {people.noun || "people"}: 0.</EmptyLine>}

      {single && people.total > 0 && (
        <>
          <RoleCounts counts={people.departments[0].counts} />
          {names && (
            <Box component="ol" aria-label={`${people.title}`} sx={{ m: 0, mt: 0.75, p: 0 }}>
              {people.departments[0].members.map((m, i) => (
                <NumberedPerson key={`${m.role}:${m.name}:${i}`} index={i + 1} name={m.name} role={m.role} department={people.departments[0].name} />
              ))}
            </Box>
          )}
          {names && people.departments[0].total > people.departments[0].members.length && (
            <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
              …and {people.departments[0].total - people.departments[0].members.length} more
            </Typography>
          )}
        </>
      )}

      {!single && people.departments.length > 0 && people.total > 0 && !names && (
        <StatList label="Count by department">
          {people.departments.map((d) => (
            <Box component="li" key={d.name} sx={{ listStyle: "none", py: 0.5, borderTop: "1px solid var(--sv-border)", "&:first-of-type": { borderTop: 0 } }}>
              <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
                <Typography variant="body2" fontWeight={600} sx={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                  {d.name}
                </Typography>
                <Typography variant="body2" fontWeight={800} sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {d.total}
                </Typography>
              </Box>
              <RoleCounts counts={d.counts} />
            </Box>
          ))}
        </StatList>
      )}

      {!single && names &&
        people.departments.map((d) => (
          <Section key={d.name} icon={BusinessOutlinedIcon} title={d.name} count={d.total}>
            <RoleCounts counts={d.counts} />
            <Box component="ol" aria-label={`${people.title}: ${d.name}`} sx={{ m: 0, mt: 0.5, p: 0 }}>
              {(d.members || []).map((m, i) => (
                <NumberedPerson key={`${m.role}:${m.name}:${i}`} index={i + 1} name={m.name} role={m.role} department={d.name} />
              ))}
            </Box>
            {d.total > (d.members || []).length && (
              <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
                …and {d.total - (d.members || []).length} more
              </Typography>
            )}
          </Section>
        ))}

      {people.emptyDepartments?.length > 0 && (
        <Typography variant="caption" display="block" sx={{ mt: 1, color: "var(--sv-muted)" }}>
          None in: {people.emptyDepartments.join(", ")}.
        </Typography>
      )}

      {admins && (
        <Section icon={BadgeOutlinedIcon} title="Administrators" count={admins.total}>
          {admins.total === 0 ? (
            <EmptyLine>No active administrators. Total administrators: 0.</EmptyLine>
          ) : (
            <Box component="ol" aria-label="Administrators" sx={{ m: 0, p: 0 }}>
              {admins.members.map((m, i) => (
                <NumberedPerson key={`${m.name}:${i}`} index={i + 1} name={m.name} role="Admin" />
              ))}
            </Box>
          )}
        </Section>
      )}
    </CardFrame>
  );
}

// One person: name, role, department(s), and whether the account is active.
export function PersonCard({ person }) {
  if (!person) return null;
  const departments = person.departments || (person.department ? [person.department] : []);
  return (
    <CardFrame label={`About ${person.name}`} icon={BadgeOutlinedIcon} title="Person" subtitle="Name, role and department">
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
    <CardFrame label="Departments" icon={BusinessOutlinedIcon} title="Departments" subtitle="Departments you can ask about" badge={<CountBadge>{departments.length}</CountBadge>}>
      <Box component="ul" aria-label="Departments" sx={{ m: 0, p: 0, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {departments.map((d) => (
          <Box component="li" key={d} sx={{ listStyle: "none", display: "inline-flex", alignItems: "center", gap: 0.5, px: 1.1, py: 0.5, borderRadius: 99, bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)", fontSize: 13.5, fontWeight: 600, maxWidth: "100%", overflowWrap: "anywhere" }}>
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
      <CardFrame label="People by department" icon={GroupsOutlinedIcon} title="People by department" subtitle="Active people, by role">
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
      <CardFrame label="Tickets by department" icon={ConfirmationNumberOutlinedIcon} title="Tickets by department" subtitle="Total and open tickets you can see" badge={<PeriodBadge period="All time" />}>
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
      <CardFrame label="Manager and Team Lead assignments" icon={SupervisorAccountOutlinedIcon} title="Managers and Team Leads" subtitle="Who manages each department">
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
    <CardFrame label="Users by role" icon={GroupsOutlinedIcon} title="Users by role" subtitle="Active users">
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
    <CardFrame label="Weekly ticket report" icon={AssessmentOutlinedIcon} title="Weekly ticket report" subtitle="Created, resolved and closed tickets" badge={<PeriodBadge period={{ label: "Last 7 days", rangeText: `${fmt(report.from)} – ${fmt(report.to)}` }} />}>
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
