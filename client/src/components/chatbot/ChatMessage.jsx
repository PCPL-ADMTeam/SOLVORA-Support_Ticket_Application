import { useState } from "react";
import { Box, Button, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { format } from "date-fns";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RobotAvatar from "./RobotAvatar";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import HistoryToggleOffIcon from "@mui/icons-material/HistoryToggleOff";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import TicketListCard from "./TicketListCard";
import TicketSummaryCard from "./TicketSummaryCard";
import TicketHistoryCard from "./TicketHistoryCard";
import StatisticsCard from "./StatisticsCard";
import ChatFeedback from "./ChatFeedback";
import ActionConfirmCard from "./ActionConfirmCard";
import TicketDraftCard from "./TicketDraftCard";
import TicketReasonsCard from "./TicketReasonsCard";
import FormattedText from "./response/FormattedText";
import NoticeBanner from "./response/NoticeBanner";
import WhatsNewCard from "./response/WhatsNewCard";
import SummaryReportCard from "./response/SummaryReportCard";
import OverviewCard from "./response/OverviewCard";
import NotificationsCard from "./response/NotificationsCard";
import { DepartmentListCard, DepartmentStatsCard, PeopleCard, PersonCard, RoleCountsCard, WeeklyReportCard } from "./response/DirectoryCards";
import { card, focusRing, reducedMotion, rise, srOnly } from "./theme/chatStyles";

const enter = { animation: `${rise} var(--sv-base) ease both`, ...reducedMotion };
const small = { fontSize: 18 };
const actionBtn = { color: "var(--sv-muted)", "&:hover": { color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)" }, ...focusRing };

// The name shown on the assistant's replies.
const ASSISTANT_NAME = "Solvy";

// Icon for a suggested question, chosen from its wording only.
const ICONS = [
  [/resolved|closed|done/i, CheckCircleOutlineIcon],
  [/assigned|people|employee|manager|who/i, PersonOutlineIcon],
  [/department|team/i, GroupsOutlinedIcon],
  [/notification/i, NotificationsNoneIcon],
  [/open|progress|hold|pending/i, HistoryToggleOffIcon],
];
const iconFor = (prompt) => (ICONS.find(([re]) => re.test(prompt)) || [null, ConfirmationNumberOutlinedIcon])[1];

// "Try:" plus bullet lines is appended by the server when a request was not understood.
// They are shown as buttons below the message, so the bullet text is split off here.
const TRY_BLOCK = /\n+Try(?: one of these)?:\n(?:•.*(?:\n|$))+\s*$/;

// Answers whose details are shown as a card. For these the bubble shows a one-line headline instead of
// repeating every number as prose (Copy still copies the full text).
const hasCard = (data) =>
  Boolean(data.digest || data.summaryReport || data.overview || data.notifications?.items || data.departmentMembers || data.person || data.userSummary || data.headcount || data.ticketsByDepartment || data.assignments || data.roles || data.weeklyReport || (data.departments && data.headline));
const firstLine = (text) => String(text || "").split("\n")[0].replace(/:\s*$/, ".");

function Time({ at }) {
  if (!at) return null;
  return (
    <Typography component="time" dateTime={new Date(at).toISOString()} variant="caption" sx={{ color: "var(--sv-muted)", fontSize: 11 }}>
      {format(new Date(at), "h:mm a")}
    </Typography>
  );
}

// A full-width question button: icon, text, chevron.
function ActionList({ actions, onSend, disabled }) {
  return (
    <Box role="group" aria-label="Suggested questions" sx={{ mt: 1.25, display: "grid", gap: 0.75 }}>
      {actions.map((a) => {
        const Icon = iconFor(a.prompt);
        return (
          <Box
            key={a.prompt}
            component="button"
            type="button"
            onClick={() => onSend(a.prompt)}
            disabled={disabled}
            sx={{ display: "flex", alignItems: "center", gap: 1.25, font: "inherit", fontSize: 14, textAlign: "left", cursor: "pointer", px: 1.5, py: 1.1, color: "var(--sv-text)", bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)", borderRadius: "12px", transition: "border-color var(--sv-fast) ease", "&:hover:not(:disabled)": { borderColor: "var(--sv-accent-ink)" }, "&:disabled": { opacity: 0.55, cursor: "default" }, ...focusRing, ...reducedMotion }}
          >
            <Icon aria-hidden sx={{ fontSize: 20, color: "var(--sv-accent-ink)" }} />
            <Box component="span" sx={{ flex: 1 }}>
              {a.label}
            </Box>
            <ChevronRightIcon aria-hidden sx={{ fontSize: 20, color: "var(--sv-muted)" }} />
          </Box>
        );
      })}
    </Box>
  );
}

// "You can also try": next steps as chips on a soft panel, after an answer.
function AlsoTry({ actions, onSend, disabled }) {
  return (
    <Box role="group" aria-label="Follow-up questions" sx={{ mt: 1.25, p: 1.25, borderRadius: "14px", bgcolor: "var(--sv-accent-soft)" }}>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75, color: "var(--sv-text)" }}>
        <AutoAwesomeIcon sx={{ fontSize: 16, color: "var(--sv-accent-ink)" }} />
        <Typography variant="body2">You can also try:</Typography>
      </Stack>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {actions.map((a) => (
          <Box
            key={a.prompt}
            component="button"
            type="button"
            onClick={() => onSend(a.prompt)}
            disabled={disabled}
            sx={{
              font: "inherit",
              fontSize: 13,
              fontWeight: 600,
              px: 1.4,
              py: 0.55,
              borderRadius: 99,
              cursor: "pointer",
              color: "var(--sv-accent-ink)",
              bgcolor: "var(--sv-surface)",
              border: "1px solid var(--sv-accent-ink)",
              transition: "transform var(--sv-fast) ease",
              "&:hover:not(:disabled)": { transform: "translateY(-1px)" },
              "&:disabled": { opacity: 0.55, cursor: "default" },
              ...focusRing,
              ...reducedMotion,
            }}
          >
            {a.label}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

// Assistant text is always rendered as TEXT (React-escaped; pre-line keeps the
// numbered steps) — never as HTML — so ticket-derived strings cannot inject markup.
export default function ChatMessage({ message, onNavigate, onSend, onFeedback, disabled, actionState = {}, onConfirmAction, onCancelAction, onEditAction, previews, onRemoveAttachment, activeDraftKey, draftTools, firstName }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context); nothing else to do.
    }
  };

  if (message.role === "user") {
    const initial = String(firstName || "").trim().charAt(0).toUpperCase();
    return (
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.25, ...enter }}>
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1, maxWidth: "92%" }}>
          <Box sx={{ minWidth: 0, background: "var(--sv-accent-gradient)", color: "var(--sv-on-accent)", px: 1.75, py: 1.1, borderRadius: "var(--sv-radius-bubble)", borderBottomRightRadius: 6 }}>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "inherit" }}>
              <Box component="span" sx={srOnly}>
                You said:{" "}
              </Box>
              {message.text}
            </Typography>
          </Box>
          {initial && (
            <Box aria-hidden sx={{ width: 30, height: 30, flexShrink: 0, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)", border: "1px solid var(--sv-accent-ink)" }}>
              {initial}
            </Box>
          )}
        </Box>
        <Time at={message.at} />
      </Box>
    );
  }

  const { data = {}, navigationTarget, suggestedActions = [], error } = message;
  // A ticket card already has its own Open button; don't repeat the same link under it.
  const cardOpensTarget = Boolean(navigationTarget?.path && data.tickets?.some((t) => navigationTarget.path === `/tickets/${t.ticketRouteId}`));
  // "I couldn't understand that request. Try: ..." becomes the message plus a list of buttons.
  const isFallback = TRY_BLOCK.test(message.text || "");
  const fullText = isFallback ? message.text.replace(TRY_BLOCK, "") : message.text;
  const bodyText = data.headline || (hasCard(data) ? firstLine(fullText) : fullText);
  // The ticket list has its own "View all" row for the next page.
  const hasMore = Boolean(data.tickets && data.total > data.tickets.length);
  const actions = suggestedActions.filter((a) => !(hasMore && a.prompt === "Show more"));
  const nextSteps = actions.length > 0 && !isFallback && !data.pendingAction;
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, ...enter }}>
      <RobotAvatar size={30} sx={{ mt: 0.25 }} />
      <Box sx={{ minWidth: 0, maxWidth: "calc(100% - 38px)", flex: 1 }}>
        <Box sx={{ ...card, display: "inline-block", maxWidth: "100%", px: 1.75, py: 1.25, borderRadius: "var(--sv-radius-bubble)", borderTopLeftRadius: 6, boxSizing: "border-box" }}>
          <Typography variant="caption" display="block" sx={{ color: "var(--sv-muted)", fontWeight: 600 }}>
            {ASSISTANT_NAME}
          </Typography>
          <NoticeBanner error={error} />
          <FormattedText text={bodyText} />
          {isFallback && !/one of these\?\s*$/.test(bodyText) && (
            <Typography variant="caption" display="block" sx={{ mt: 0.5, color: "var(--sv-muted)" }}>
              Try one of these:
            </Typography>
          )}
          {message.interpretation?.method === "openrouter" && (
            <Typography variant="caption" display="block" sx={{ mt: 0.5, color: "var(--sv-muted)" }}>
              Understood with AI. Data and changes still go through the secured tools.
            </Typography>
          )}

          {data.digest && <WhatsNewCard digest={data.digest} onNavigate={onNavigate} onSend={onSend} disabled={disabled} />}
          {data.summaryReport && <SummaryReportCard report={data.summaryReport} />}
          {data.overview && <OverviewCard overview={data.overview} />}
          {data.notifications?.items && <NotificationsCard notifications={data.notifications} onNavigate={onNavigate} />}
          {data.departmentMembers && <PeopleCard departments={data.departmentMembers} />}
          {(data.person || data.userSummary) && <PersonCard person={data.person || data.userSummary} />}
          {data.departments && data.headline && <DepartmentListCard departments={data.departments} />}
          {(data.headcount || data.ticketsByDepartment || data.assignments) && <DepartmentStatsCard headcount={data.headcount} ticketsByDepartment={data.ticketsByDepartment} assignments={data.assignments} />}
          {data.roles && <RoleCountsCard roles={data.roles} />}
          {data.weeklyReport && <WeeklyReportCard report={data.weeklyReport} />}
          {data.tickets && <TicketListCard tickets={data.tickets} total={data.total} listing={data.listing} onNavigate={onNavigate} onSend={onSend} />}
          {data.summary && <TicketSummaryCard summary={data.summary} />}
          {data.summaries && data.summaries.map((s) => <TicketSummaryCard key={s.ticketId} summary={s} compact />)}
          {data.history && <TicketHistoryCard history={data.history} />}
          {data.reasons && <TicketReasonsCard reasons={data.reasons} />}
          {data.statistics && <StatisticsCard statistics={data.statistics} />}
          {data.ticketDraft && (
            <TicketDraftCard
              draft={data.ticketDraft}
              previews={previews}
              onRemove={onRemoveAttachment}
              onSend={onSend}
              tools={draftTools}
              active={Boolean(activeDraftKey) && message.key === activeDraftKey && !actionState[data.pendingAction?.id]?.status?.match(/EXECUTED|CANCELLED|SUPERSEDED/)}
              disabled={disabled}
              compact={Boolean(data.pendingAction)}
            />
          )}
          {data.pendingAction && (
            <ActionConfirmCard action={data.pendingAction} state={actionState[data.pendingAction.id]} onConfirm={onConfirmAction} onCancel={onCancelAction} onEdit={onEditAction} />
          )}

          {isFallback && actions.length > 0 && <ActionList actions={actions} onSend={onSend} disabled={disabled} />}

          {navigationTarget && !cardOpensTarget && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInNewIcon />}
              sx={{ mt: 1, color: "var(--sv-accent-ink)", borderColor: "var(--sv-accent-ink)", ...focusRing }}
              onClick={() => onNavigate(navigationTarget)}
            >
              {navigationTarget.label}
            </Button>
          )}
        </Box>

        <Stack direction="row" alignItems="center" spacing={0.25} sx={{ mt: 0.5, ml: 0.5 }}>
          <Time at={message.at} />
          <Tooltip title={copied ? "Copied" : "Copy"}>
            <IconButton size="small" aria-label={copied ? "Response copied" : "Copy response"} onClick={copy} sx={actionBtn}>
              {copied ? <CheckIcon sx={small} /> : <ContentCopyIcon sx={small} />}
            </IconButton>
          </Tooltip>
          {message.messageId && !error?.retryable && <ChatFeedback messageId={message.messageId} onSubmit={onFeedback} />}
        </Stack>

        {nextSteps && <AlsoTry actions={actions} onSend={onSend} disabled={disabled} />}
      </Box>
    </Box>
  );
}
