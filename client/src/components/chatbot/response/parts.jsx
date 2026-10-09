import { Box, Stack, Typography } from "@mui/material";
import EventOutlinedIcon from "@mui/icons-material/EventOutlined";
import { focusRing, reducedMotion } from "../theme/chatStyles";

// Shared pieces for Solvy's structured answers. Everything here renders TEXT (React-escaped), never
// HTML, and lays out in a single column on narrow screens so nothing scrolls sideways.

// The outer card that holds one structured answer.
export function CardFrame({ label, children, sx }) {
  return (
    <Box
      component="section"
      aria-label={label}
      sx={{ mt: 1, p: 1.5, bgcolor: "var(--sv-bg)", border: "1px solid var(--sv-border)", borderRadius: "14px", color: "var(--sv-text)", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", overflowWrap: "anywhere", ...sx }}
    >
      {children}
    </Box>
  );
}

// Title row of a card: title on the left, an optional badge (e.g. the period) wrapping below on narrow screens.
export function CardTitle({ children, badge }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={0.75} sx={{ mb: 1 }}>
      <Typography component="h4" variant="subtitle2" fontWeight={800} sx={{ color: "var(--sv-text)", lineHeight: 1.3 }}>
        {children}
      </Typography>
      {badge}
    </Stack>
  );
}

// "Today · Oct 9, 2026": what a set of numbers covers, always shown with them.
export function PeriodBadge({ period }) {
  if (!period) return null;
  const text = typeof period === "string" ? period : [period.label, period.rangeText && period.rangeText !== period.label ? period.rangeText : null].filter(Boolean).join(" · ");
  return (
    <Box component="span" title={period.timeZone ? `Dates in ${period.timeZone}` : undefined} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 1, py: 0.25, borderRadius: 99, fontSize: 12, fontWeight: 600, color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)" }}>
      <EventOutlinedIcon aria-hidden sx={{ fontSize: 14 }} />
      {text}
    </Box>
  );
}

// One titled group inside a card, e.g. "Notifications" or "Assigned to You".
export function Section({ icon: Icon, title, count, children, label }) {
  return (
    <Box component="section" aria-label={label || title} sx={{ pt: 1.25, mt: 1.25, borderTop: "1px solid var(--sv-border)", "&:first-of-type": { pt: 0, mt: 0, borderTop: 0 } }}>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
        {Icon && <Icon aria-hidden sx={{ fontSize: 18, color: "var(--sv-accent-ink)" }} />}
        <Typography component="h5" variant="body2" fontWeight={700} sx={{ flex: 1, minWidth: 0 }}>
          {title}
        </Typography>
        {count !== undefined && count !== null && (
          <Box component="span" sx={{ minWidth: 24, px: 0.75, height: 22, display: "inline-grid", placeItems: "center", borderRadius: 99, fontSize: 12, fontWeight: 800, color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)" }}>
            {count}
          </Box>
        )}
      </Stack>
      {children}
    </Box>
  );
}

// A label and its value on one line ("Unread notifications ........ 2").
export function StatRow({ label, value, hint }) {
  return (
    <Box component="li" sx={{ listStyle: "none", display: "flex", alignItems: "baseline", gap: 1, py: 0.35 }}>
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0, color: "var(--sv-text)" }}>
        {label}
        {hint && (
          <Typography component="span" variant="caption" sx={{ ml: 0.5, color: "var(--sv-muted)" }}>
            {hint}
          </Typography>
        )}
      </Typography>
      <Typography variant="body2" fontWeight={800} sx={{ color: "var(--sv-text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
    </Box>
  );
}

export function StatList({ children, label }) {
  return (
    <Box component="ul" aria-label={label} sx={{ m: 0, p: 0 }}>
      {children}
    </Box>
  );
}

// A small number tile; a colour, when given, is an accent only (the label always carries the meaning).
export function StatTile({ label, value, color, muted = false }) {
  return (
    <Box component="li" sx={{ listStyle: "none", minWidth: 0, p: 1, bgcolor: "var(--sv-surface)", border: "1px solid var(--sv-border)", borderLeft: `4px solid ${color || "var(--sv-accent-ink)"}`, borderRadius: "10px", opacity: muted ? 0.8 : 1 }}>
      <Typography component="div" sx={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, color: "var(--sv-text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      <Typography variant="caption" sx={{ color: "var(--sv-muted)", display: "block", lineHeight: 1.25 }}>
        {label}
      </Typography>
    </Box>
  );
}

// Tiles that wrap to as many columns as fit (one column on a phone).
export function TileGrid({ children, label, min = 96 }) {
  return (
    <Box component="ul" aria-label={label} sx={{ m: 0, p: 0, display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`, gap: 0.75 }}>
      {children}
    </Box>
  );
}

// A full-width soft button inside a card ("View Notifications", "View all 7").
export function CardAction({ icon: Icon, children, onClick, disabled, ariaLabel }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      sx={{ mt: 1, display: "inline-flex", alignItems: "center", gap: 0.75, font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", px: 1.25, py: 0.6, borderRadius: "10px", color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)", border: "1px solid transparent", "&:hover:not(:disabled)": { borderColor: "var(--sv-accent-ink)" }, "&:disabled": { opacity: 0.55, cursor: "default" }, ...focusRing, ...reducedMotion }}
    >
      {Icon && <Icon aria-hidden sx={{ fontSize: 16 }} />}
      {children}
    </Box>
  );
}

// A clear "nothing here" line (zero results are said, never left blank).
export function EmptyLine({ children }) {
  return (
    <Typography variant="body2" sx={{ color: "var(--sv-muted)" }}>
      {children}
    </Typography>
  );
}
