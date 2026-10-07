# Chatbot — Knowledge Base

Location: `server/src/chatbot/knowledge/`

```
knowledge/
  schema.js          article() helper, route()/dialog() target builders
  index.js           getArticle(id, role), searchArticles(query, role), articlesForRole(role)
  common/articles.js     all roles
  employee/articles.js
  team-lead/articles.js  also exports the shared agent-portal set
  manager/articles.js    re-uses the shared agent-portal set
  admin/articles.js
```

Manager and Team Lead share one portal (`/agent`), so their navigation articles are defined once (`team-lead/articles.js#shared`) and re-used.

## Entry fields

| Field | Meaning |
|---|---|
| `id` | stable id, e.g. `agent.assignment` |
| `title` | article title |
| `roles` | `["ALL"]` or any of `EMPLOYEE`, `TEAMLEAD`, `MANAGER`, `ADMIN` — the portal role(s) |
| `permissions` | optional applicable permissions (empty = none beyond role) |
| `feature` | feature / page name as labeled in the UI |
| `route` | `{type:"route", path, label}`, `{type:"dialog", dialog, label}`, or `null` |
| `steps` | ordered step-by-step instructions |
| `warning` | prerequisite or caveat shown after the steps, or `null` |
| `keywords` | search terms (substring match; longer phrases weigh more) |
| `lastReviewed` | `YYYY-MM-DD` |
| `active` | inactive articles are never returned |

## Rules

* **Routes and labels come from the frontend** (`App.jsx`, the layouts, `ProfileDialog.jsx`, ticket page buttons). A test checks every route target exists in `App.jsx`.
* Profile and password have **no route**: they are dialogs opened from the avatar menu, so their targets are `dialog` targets that the widget opens through `AppShell`.
* **Role filtering is applied before matching.** An Employee asking about "manage users" gets a generic "not available for your role" answer and no navigation target; the article's existence is not revealed.
* Features the application does **not** have are documented as such (SLA, escalation, categories page, notification settings page) so the assistant never invents steps.
* Article text is trusted server content and is returned verbatim; it is never passed through a model.

## Current articles

Common: view profile, update profile, change password, ticket status, ticket priority, SLA, escalation, notifications, ticket history, attachments, add comment.
Employee: create ticket, view tickets, dashboard, close/reopen, assignment.
Team Lead / Manager (shared): create ticket, manage department tickets, dashboard, assignment, transfer department, close/reopen. Team Lead: team workload. Manager: department scope.
Admin: all tickets, dashboard, users and roles, departments, priorities (SLA configuration pointer), categories (does not exist), email templates / notification settings, audit logs, settings, assignment (admins cannot assign).

## Adding or changing an article

1. Confirm the route/label in the frontend source.
2. Add `article({...})` to the right folder (or the shared agent set).
3. If the article should have its own intent name, add it to `ARTICLE_INTENTS` in `intents/router.js`.
4. Run `npm test` in `server/` — the metadata, route and role-filter tests will catch mistakes.
5. Update `lastReviewed` whenever you re-verify an article.
