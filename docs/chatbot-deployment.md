# Chatbot — Deployment and Local Setup

## 1. Apply the migration

The chatbot adds five tables (three migrations: `20261006090000_add_chatbot_tables`, `20261006120000_add_chat_pending_actions`, `20261006150000_chat_pending_action_hardening`, the last adding the token hash, record-version snapshot and interpretation columns): `chat_conversations`, `chat_messages`, `chat_feedback`, `chat_audit_events` (`20261006090000_add_chatbot_tables`) and `chat_pending_actions` (`20261006120000_add_chat_pending_actions`, admin changes awaiting confirmation). They only create new tables and foreign keys; existing tables and data are untouched.

```bash
cd server
npx prisma migrate deploy      # production / CI
# or, locally:
npx prisma migrate dev
npx prisma generate
```

Docker Compose applies migrations on boot, as before. **If the server container keeps its own `node_modules` volume (as this repo's compose file does), also regenerate the Prisma client inside it, otherwise chat requests fail with a database error:** `docker exec helpdesk-server npx prisma generate && docker restart helpdesk-server`.

## 2. Configure

Add to `server/.env` (see `server/.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `CHATBOT_PROVIDER` | `mock` | `mock` (no network, answers from server-built text) or `anthropic` |
| `CHATBOT_MODEL` | — | required for `anthropic` |
| `CHATBOT_API_KEY` | — | required for `anthropic`; **secret**, server only |
| `CHATBOT_ENDPOINT` | Anthropic Messages API URL | optional; must be `https://` |
| `CHATBOT_TIMEOUT_MS` | `15000` | 1000–120000 |
| `CHATBOT_MAX_RETRIES` | `1` | 0–3 (transient failures only) |
| `CHATBOT_RATE_LIMIT_WINDOW_MS` | `60000` | per-user window |
| `CHATBOT_RATE_LIMIT_MAX` | `20` | requests per user per window (messages, confirmations, feedback). Each admin change uses two (preview + confirm) |

Configuration is validated at startup (`providers/index.js#validateChatbotConfig`). An invalid configuration is logged and the model is disabled — the chatbot keeps answering from its server-built text and the rest of the API is unaffected. `mock` in production logs a warning (the assistant works, without model phrasing).

### AI interpretation (optional)

Set the `AI_*` / `OPENROUTER_*` variables from `server/.env.example`, choose models with `npm run ai:check -- --candidates`, verify with `npm run ai:check`, restart, and check `GET /api/v1/chatbot/diagnostics/ai` as an admin. Until a real key and a verified intent model are set, AI interpretation stays off and everything else works. Details: `docs/chatbot-ai-interpretation.md`.

Nothing is needed on the client: the widget uses the existing `VITE_API_BASE_URL`.

## 3. Run locally

```bash
cd server && npm install && npx prisma migrate dev && npm run seed && npm run dev
cd client && npm install && npm run dev
```

Sign in as any role and use the round chat button (bottom right). With the default `mock` provider no key is required.

## 4. Verify before release

1. `cd server && npm test` and `cd client && npm test && npm run build`.
2. Smoke test on a real database as each of the four roles: suggestions load; "Show my open tickets"; "Summarize ticket <number>" for an own ticket and for someone else's (must read "couldn't find a ticket … you have access to"); "How do I change my password?" then the *Open password settings* button.
3. Confirm `chat_audit_events` receives rows and contains no message text.

## 5. Operations

* **Retention:** run `purgeOldChatData(days)` from `server/src/chatbot/retention.js` on a schedule that matches your policy, for example from a cron job or the existing scheduler of your choice:
  ```bash
  node -e "require('./src/chatbot/retention').purgeOldChatData(90).then(console.log).then(()=>process.exit(0))"
  ```
* **Reviewing feedback:** `chat_feedback` rows with `rating = 'unauthorized_information'` (and audit action `FEEDBACK_UNAUTHORIZED_INFORMATION`) should be triaged first.
* **Multiple server instances:** the per-user rate limiter is in-memory; use a shared store if you scale out.
* **Rollback:** the feature is additive. Removing the `/chatbot` route mount and the `ChatWidget` line in `AppShell.jsx` disables it; the tables can stay.
* **Third-party processing:** with `anthropic`, text of tickets the user may view is sent to the provider. Get sign-off first. With `mock` nothing leaves the server.
