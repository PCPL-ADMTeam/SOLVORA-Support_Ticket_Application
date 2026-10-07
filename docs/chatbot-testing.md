# Chatbot — Testing

## Commands

```bash
# Backend (Jest, runs against an in-memory Prisma double — no database needed)
cd server && npm test

# Frontend (Vitest + React Testing Library + jsdom)
cd client && npm test

# Production build
cd client && npm run build
```

## Backend (`server/src/chatbot/__tests__/`)

| File | Covers |
|---|---|
| `authorization.test.js` | Employee A vs B; neutral not-found vs forbidden (audited differently); manipulated/SQL-ish ticket ids; internal notes never returned; team lead vs unrelated department; manager vs unrelated department; non-admin blocked from admin-only guidance and system-wide stats; employee blocked from team/department views; caller-supplied role ignored; conversation/message ownership (including admin). |
| `functional.test.js` | profile and password guidance (real labels/targets), role-specific navigation targets, ticket search, summary contract and "not available" handling, pending actions vs suggestions, latest update, history, status/priority/SLA/escalation explanations, no-result, invalid ticket id, multi-turn follow-ups, reset, feedback, input validation, database-failure masking, suggested prompts per role (and that none is a dead prompt), knowledge-base metadata/routes/role filtering. |
| `security.test.js` | prompt injection in ticket title, summary, comments, history values and attachment metadata; injection in user messages; model output validation (prompt echo, canary, unauthorized ticket numbers, wrong types, oversized, thrown errors) with fallback to the server draft; no provider configured; guidance never sent to the model; role prompts; no internals in errors; audit rows contain no content. |
| `providers.test.js` | config validation, mock provider, Anthropic provider (request shape, retries, timeouts, no key leakage), prompt-builder delimiter defanging. |
| `actions.test.js` | admin changes: nothing executes before confirmation, typed "yes" never executes, once-only/concurrent confirm, cancel, expiry, owner binding, role re-check, non-admin refusal, every action calls the right service with resolved ids, 20 preview-time validation failures, honest failure reporting, redirects for unsupported requests, injected ticket text cannot trigger changes, reports and their scoping. |
| `rbac.test.js` | permissions are derived from the role and deny by default; the full **role x tool matrix** (allowed vs denied, with audit); strict tool inputs; Admin (all departments, close/role/add-employee after confirmation, no raise/assign, deactivation dependencies); Manager and Team Lead (own departments only, neutral out-of-scope answers, assignment eligibility, no user management); Employee (raise a ticket through guided questions, raised-by-or-assigned only, same department is not enough, comment/reopen/status/close rules, no assigning or user management); frontend role/permissions ignored; expired, replayed and token-less confirmations; permission re-checked at confirmation; resource changes after the preview; honest failures; audit contents; injected ticket text. |
| `rules.test.js` | rule engine: equivalent phrasings to one intent, typo/synonym normalization, priority/department/ranking extraction, confidence (reliable vs weak), false-positive prevention. |
| `interpretation.test.js` | server-owned registry integrity, strict schema and role-filtered prompt, output validation (15 rejection cases, role checks, low confidence, server-decided missing fields), AI configuration, redaction, circuit breaker, daily limiter. |
| `openrouter.test.js` | OpenRouter request shape (strict JSON schema, provider routing, headers), retries, bounded fallback models, one overall time budget, auth failure, no key leakage, disabled/mock providers, model-capability evaluation and caching (public catalog, one fetch per window), summary provider. |
| `hybrid.test.js` | end-to-end hybrid flow with an injected interpreter: rules skip the model, free-form wording reaches the same secured tools and numbers, model output can't widen anything, prompt injection, data never sent to the model, AI-identified writes are previews only, typed yes/cancel, clarification, numbered entity selection, state expiry/ownership, AI unavailable/breaker/daily cap/disabled, response contract, confirmation hardening (token, conversation, version check, single use), diagnostics. |
| `http.test.js` | real routes via supertest: auth required on every endpoint, response shape, body role ignored, validation → `CHAT_INVALID_INPUT`, ownership 404s, feedback, suggestions per role, per-user rate limiting. |

The real application scope functions (`ticket.service.js`) are executed; only Prisma is replaced by `testkit/prismaMock.js`, which implements the query operators involved (`AND`/`OR`, `in`, `not`, `contains`, `gte`/`lt`, `select`, `take`, `orderBy`, `groupBy`). A mutation check (replacing the authorized scope with `{}`) makes the authorization tests fail, confirming they are not vacuous.

`jest.config.js` maps `sanitize-html` to a stub (test only): `ticket.service.js` imports it transitively and its ESM-only dependencies cannot be loaded by Jest's CommonJS transform — a gap that pre-dates the chatbot.

## Frontend (`client/src/components/chatbot/__tests__/ChatWidget.test.jsx`)

Open/close, Escape and focus return, server-provided welcome/suggestions, sending (loading state, conversation id reuse, no role sent), suggested-prompt selection, empty input, error + retry (without duplicating the user bubble), non-retryable errors, suggestions-load retry, ticket list/summary cards (badges, "Not available", facts vs suggestions), text-not-HTML rendering, route and dialog navigation, follow-up actions, feedback and report menu, copy, reset, live-region/log semantics, keyboard operation, mobile full-screen behavior.

## Not covered

* Live OpenRouter calls are not part of `npm test` (the test environment forces AI off and never reaches the network); the HTTP contract is tested with fake clients. Real PostgreSQL integration is not part of `npm test` (Prisma engines do not load natively on Windows ARM64); it was verified separately in Docker, see below. Repeat that check on your own environment before release.
* Real model provider: only the HTTP contract is tested with a fake client.
* Visual/responsive appearance and screen-reader behavior beyond ARIA semantics need a manual pass in a browser.

## Real-database verification (not part of `npm test`)

The unit tests replace the services with spies, so service-level rules were also checked against a throwaway PostgreSQL 16 and the real services in Docker: migrations applied from scratch, then 37 end-to-end checks (create/rename department with its default "Others" issue and both audit entries, manager grant/removal, Team Lead cap, deactivated users really cannot log in and can again after activation, role change, priority change and ticket close with history rows, non-admin 403s, reports). All passed. The throwaway script was not added to the repository.

## Phrasing corpus and misses (keeping the rules honest)

Real questions that were once answered wrongly live in `server/src/chatbot/__tests__/corpus/phrasings.json`
as `{ role, text, expect: { intent, params (subset) } }` and are checked by `corpus.test.js` on every run.

Workflow when a question gets a bad answer:
1. Find it: `npm run chat:misses` (or `GET /api/v1/chatbot/diagnostics/misses?days=30`, Admin only). It lists
   questions that ended as "not understood" or "no results", or that someone rated not helpful / incorrect,
   grouped and counted. Nothing extra is stored: it is built from the existing chat messages and feedback,
   and emails and long numbers are masked.
2. Add a corpus entry with what the assistant should have understood.
3. Fix the rule or entity extractor until `npm test` passes. Prefer fixing a category (departments, priorities,
   statuses, dates in `chatbot/entities/`) over adding a one-off phrasing.
