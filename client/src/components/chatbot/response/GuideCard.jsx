import { Box, Stack, Typography } from "@mui/material";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import TipsAndUpdatesOutlinedIcon from "@mui/icons-material/TipsAndUpdatesOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import { Callout, CardFrame, Section, StatList, StatRow } from "./parts";
import { StatusChip, priorityColor } from "../TicketChips";

// How-to answers: the steps of a task in the application (a knowledge-base article) or the transfer
// guide. Steps are numbered, notes and warnings are set apart, and for the transfer guide the card says
// first whether THIS user may do it. Text only, never HTML.

function Steps({ steps }) {
  if (!steps?.length) return null;
  return (
    <Box component="ol" aria-label="Steps" sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 0.9 }}>
      {steps.map((s, i) => (
        <Box component="li" key={`${i}-${s}`} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          <Box aria-hidden sx={{ width: 24, height: 24, flexShrink: 0, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12.5, fontWeight: 800, color: "var(--sv-on-accent)", background: "var(--sv-accent-gradient)" }}>
            {i + 1}
          </Box>
          <Typography variant="body2" sx={{ pt: 0.25, wordBreak: "break-word", color: "var(--sv-text)" }}>
            {s}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

const ACCESS = {
  ok: { icon: CheckCircleOutlineIcon, label: "You can do this" },
  blocked: { icon: LockOutlinedIcon, label: "Not available to you" },
  info: { icon: InfoOutlinedIcon, label: "Who can do this" },
};

// "#2627001 · IT Support → Finance": where the ticket is and where it would go.
function TransferRoute({ ticket, target }) {
  return (
    <Box sx={{ p: 1.1, mb: 1.25, borderRadius: "10px", bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)" }}>
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2" fontWeight={800} sx={{ color: "var(--sv-accent-ink)" }}>
          #{ticket.ticketNumber}
        </Typography>
        <StatusChip status={ticket.status} />
      </Stack>
      <Typography variant="body2" fontWeight={600} sx={{ mt: 0.25, wordBreak: "break-word" }}>
        {ticket.title}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }} aria-label="Transfer route">
        <Box>
          <Typography variant="caption" sx={{ display: "block", color: "var(--sv-muted)" }}>
            From
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            {ticket.department || "No department"}
          </Typography>
        </Box>
        <ArrowForwardIcon aria-hidden sx={{ color: "var(--sv-accent-ink)" }} />
        <Box>
          <Typography variant="caption" sx={{ display: "block", color: "var(--sv-muted)" }}>
            To
          </Typography>
          <Typography variant="body2" fontWeight={700} sx={{ color: target ? "var(--sv-text)" : "var(--sv-muted)" }}>
            {target || "Chosen on the ticket page"}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

export function TransferGuideCard({ guide }) {
  if (!guide) return null;
  const access = ACCESS[guide.access?.tone] || ACCESS.info;
  return (
    <CardFrame label={guide.title} icon={SwapHorizIcon} title={guide.title} subtitle={guide.ticket ? `Ticket #${guide.ticket.ticketNumber}` : "Done on the ticket page"}>
      {guide.ticket && <TransferRoute ticket={guide.ticket} target={guide.targetNote ? null : guide.target} />}
      {guide.targetNote && (
        <Box sx={{ mb: 1 }}>
          <Callout tone="blocked" icon={ReportProblemOutlinedIcon} label="About the destination">
            <Typography variant="body2">{guide.targetNote}</Typography>
          </Callout>
        </Box>
      )}
      {guide.access && (
        <Box sx={{ mb: 1.25 }}>
          <Callout tone={guide.access.tone} icon={access.icon} label={access.label}>
            <Typography variant="caption" fontWeight={800} sx={{ display: "block", color: "var(--sv-muted)" }}>
              {access.label}
            </Typography>
            <Typography variant="body2">{guide.access.text}</Typography>
          </Callout>
        </Box>
      )}
      <Section title="Steps">
        <Steps steps={guide.steps} />
      </Section>
      {guide.notes?.length > 0 && (
        <Section icon={TipsAndUpdatesOutlinedIcon} title="Good to know">
          <Box component="ul" sx={{ m: 0, pl: 2.25, display: "grid", gap: 0.4 }}>
            {guide.notes.map((n) => (
              <Typography component="li" key={n} variant="body2" sx={{ color: "var(--sv-text)" }}>
                {n}
              </Typography>
            ))}
          </Box>
        </Section>
      )}
    </CardFrame>
  );
}

// A knowledge-base article: its steps, its warning, and the live values some articles carry
// (the configured priorities; the user's own profile).
export default function GuideCard({ article, priorities, profile }) {
  if (!article) return null;
  return (
    <CardFrame label={article.title} icon={MenuBookOutlinedIcon} title={article.title} subtitle={article.feature ? `In Solvora: ${article.feature}` : "How to do it in Solvora"}>
      {profile && (
        <Section title="Your profile">
          <StatList label="Your profile">
            <StatRow label="Name" value={profile.name || "Not recorded"} />
            <StatRow label="Email" value={profile.email || "Not recorded"} />
            <StatRow label="Role" value={profile.role} />
            <StatRow label="Department" value={profile.departments?.length ? profile.departments.join(", ") : "Not recorded"} />
          </StatList>
        </Section>
      )}
      <Section title="Steps">
        <Steps steps={article.steps} />
      </Section>
      {priorities?.length > 0 && (
        <Section title="Configured priorities (lowest to highest)">
          <Box component="ul" aria-label="Configured priorities" sx={{ m: 0, p: 0, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {priorities.map((p) => (
              <Box component="li" key={p.name} sx={{ listStyle: "none", display: "inline-flex", alignItems: "center", gap: 0.6, px: 1, py: 0.35, borderRadius: 99, border: "1px solid var(--sv-border)", bgcolor: "var(--sv-bg)", fontSize: 13 }}>
                <Box aria-hidden component="span" sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: priorityColor(p.name, p.color) }} />
                {p.name}
              </Box>
            ))}
          </Box>
        </Section>
      )}
      {article.warning && (
        <Box sx={{ mt: 1.25 }}>
          <Callout tone="blocked" icon={InfoOutlinedIcon} label="Note">
            <Typography variant="caption" fontWeight={800} sx={{ display: "block", color: "var(--sv-muted)" }}>
              Note
            </Typography>
            <Typography variant="body2">{article.warning}</Typography>
          </Callout>
        </Box>
      )}
    </CardFrame>
  );
}
