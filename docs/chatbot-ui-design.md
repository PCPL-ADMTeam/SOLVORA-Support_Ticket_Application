# Solvora Assistant: UI design system

Visual redesign only. No chatbot behavior, API, permission or data flow changed.

## Component hierarchy

```
AppShell
└─ ChatWidget            launcher (64px, gradient, glow, unread badge, bounce) + token wrapper
   └─ ChatPanel          420x700 window (full screen on phones)
      ├─ ChatHeader      72px: avatar, title, role badge, portal, online status, reset, close
      ├─ log region
      │  ├─ ChatWelcome  hero card, quick-action cards (SuggestedPrompts), capability list
      │  ├─ ChatMessage  user gradient bubble / assistant card bubble, time, copy, feedback, follow-up chips
      │  │  ├─ TicketListCard, TicketSummaryCard, TicketHistoryCard
      │  │  ├─ StatisticsCard (KPI tiles)
      │  │  └─ ActionConfirmCard
      │  ├─ TypingIndicator
      │  └─ ChatErrorState
      └─ ChatInput       sticky 52px pill: attach (placeholder), text, voice (placeholder), send
```

## Tokens (`components/chatbot/theme/chatTokens.js`)

All styling reads CSS variables set once on a `display: contents` wrapper in `ChatWidget`, so light/dark
and the role accent are one switch (`chatThemeVars(mode, role)`).

| Token | Light | Dark |
|---|---|---|
| `--sv-bg` | #F7F8FA | #0F1115 |
| `--sv-surface` | #FFFFFF | #171A21 |
| `--sv-border` | #E5E7EB | #2A2F3A |
| `--sv-text` | #111827 | #F3F4F6 |
| `--sv-muted` | #6B7280 | #A0A7B4 |
| `--sv-success / warning / error` | #15803D / #B45309 / #DC2626 | #4ADE80 / #FBBF24 / #F87171 |

Role accents (`--sv-accent`, `--sv-accent-gradient`, `--sv-accent-ink`, `--sv-accent-soft`):
Admin red #C62828, Manager blue #1D4ED8, Team Lead purple #6D28D9, Employee green #15803D.
Fills carry white text at 4.5:1 or better; `--sv-accent-ink` is the text/icon variant that stays readable on
each surface (lighter in dark mode). The launcher keeps the Solvora brand gradient `#C62828 -> #E53935` for every role.

Red is limited to the Admin theme, the launcher, the destructive/alert states and the thin accent edge of the header.

Shape: window 24px, cards 16px, bubbles 18px, controls 10-12px. Motion: 150ms (hover), 200ms (entry), 250ms (window).
Shadows: `0 24px 60px rgba(0,0,0,.18)` window.

## Responsive

- >= 600px: 420px wide, `min(700px, 100vh - 128px)` tall, anchored above the launcher.
- < 600px: full screen, no radius; launcher hides behind the open panel (unchanged behavior).
- Quick actions: 2 columns, 1 column below 600px. KPI tiles use `auto-fill` columns.

## Accessibility

- Visible `:focus-visible` rings on every control; the composer shows a focus ring on the whole pill.
- Conversation is a polite live log; a separate status region announces typing/replies (unchanged).
- Icon-only buttons have `aria-label`s; decorative icons are `aria-hidden`; timestamps use `<time>`.
- Status is never color alone (labels and numbers always accompany the color bar).
- `prefers-reduced-motion` disables every animation and transition.

## Notes

- The role used for the theme comes from the signed-in profile and is cosmetic only; it is never sent to the server.
- Attachment and voice buttons are disabled placeholders.
- "Recent activity" and SLA/overdue quick actions are not shown: the app has no such data, and quick actions are
  the server-provided suggestions for the role.

## Chat history

The clock button in the header opens `ChatHistory` in place of the conversation: recent chats (title, relative time),
open to continue, delete with an inline confirm, and "New chat". Starting a new chat archives the current one, so
it appears in history.
