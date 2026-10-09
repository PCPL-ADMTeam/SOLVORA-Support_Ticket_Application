# Solvora — Email Notification Investigation (Phase 11)

Read-only investigation. No application code or database records were changed.
Personal email addresses are masked (`s***@powercen.com`). Sections are numbered
18–25 as requested; sections 1–17 do not exist in this repository.

**Evidence base**
- Source code at `HEAD` (`58de9b4`, 2026-10-07) plus uncommitted working-tree changes
  (the ticket-access feature; none of it touches email recipient logic).
- Git history of the ticket, notification, email and recipient files (`c024934` → `HEAD`).
- Read-only queries against the local PostgreSQL database `helpdesk` (the database
  configured in `server/.env`), which contains ticket **2600003**.
- Not available: the live server (`solvora.powercen.com`) database and logs, Exchange
  message trace, and the `helpdesk@` mailbox's Sent Items. Findings about the live
  environment are marked **unverified**.

---

## 18. Complete To/CC/BCC Recipient Matrix

### How every ticket email is built (shared path)

1. `server/src/services/ticket.service.js` decides *when* an event fires and calls a recipient
   builder in `server/src/utils/recipientBuilder.js`, which returns user **ids**:
   `userIds` (→ To) and `ccUserIds` (→ CC).
2. `server/src/services/notification.service.js#notify`:
   - dedupes To ids, creates one in-app `Notification` row **per To recipient only**;
   - resolves each id to an address via `email.service.js#resolveUserEmail`
     (Entra `mail` → Entra `userPrincipalName` → `User.email`; **inactive users return null**);
   - dedupes addresses, removes any To address from CC;
   - **if no To address remains, returns without sending — CC is never sent alone**;
   - sends **one** message: `to: [all To addresses]`, `cc: [all CC addresses]`.
3. `server/src/services/email.service.js#sendMail` posts to Microsoft Graph
   `/users/{CLOUDREADY_MAILBOX}/sendMail` with `toRecipients` and `ccRecipients`.
   **BCC is not implemented anywhere.** No address is hardcoded except the sender mailbox
   (`CLOUDREADY_MAILBOX`, env). Send failures are logged and swallowed.

### Address sources

| Recipient category | Source | Resolved |
|---|---|---|
| Requester | `Ticket.requesterId` → `User` | Dynamic |
| Department Team Lead(s) | every **active** `TEAMLEAD` with a `UserDepartmentAccess` row for `Ticket.toDepartmentId` (`userDepartmentAccess.service.js#getActiveDepartmentTeamLeads`) | Dynamic |
| Department Manager(s) | every **active** `MANAGER` with a `UserDepartmentAccess` row for `Ticket.toDepartmentId` | Dynamic |
| Assigned employee | `Ticket.assigneeId` | Dynamic |
| Custom CC | `TicketCC` rows for the ticket (set only at creation) | Dynamic |
| Delegated employee | **Not implemented** (no delegation feature) | — |
| Support team / Admin | **Never a recipient** of ticket emails | — |
| Legacy `Ticket.managerId`, `User.isManager`, `User.departmentId` | **Not read** for recipients since `501313f` | — |

### Matrix (current code)

"Intended" = the rule documented in the code comments of `recipientBuilder.js` /
`ticket.service.js` (no separate specification exists in the repo). TL = active Team Leads of
the ticket's current department; MGR = active Managers of that department.

| Notification event | Intended To | Intended CC | Actual To | Actual CC | Source of addresses | Finding |
|---|---|---|---|---|---|---|
| Ticket created / awaiting review (`TICKET_CREATED`) | All TL | Requester + MGR + Custom CC | All TL | Requester + MGR + Custom CC | `buildCreatedRecipients` | ✅ when the department has ≥1 active TL |
| ↳ department has **no active TL** | Not specified beyond a code comment ("solo confirmation to the requester") | — | **Ticket creator (requester)** | **None — MGR and Custom CC dropped** | `ticket.service.js` createTicket fallback | ⚠️ **This produced the 2600003 email** (§19) |
| Manager accepts ticket | — | — | **Not implemented** | — | — | No such event |
| Manager rejects ticket | — | — | **Not implemented** | — | — | No such event |
| Ticket assigned (`TICKET_ASSIGNED`) | Assignee | Requester + TL + MGR + Custom CC | Same | Same | `buildAssignedOrCommentRecipients` | ✅ (not sent if the assigner assigns themself — see next row) |
| Reassigned (`TICKET_REASSIGNED`) | New assignee | Requester + TL + MGR + Custom CC | Same | Same | same | ✅ previous assignee not notified (by design) |
| Self-assigned (`TICKET_SELF_ASSIGNED`) | Requester | TL + MGR + Custom CC − acting TL | Same | Same | `buildSelfAssignedRecipients` | ✅ skipped if requester is the actor |
| Delegated | — | — | **Not implemented** | — | — | No such event |
| In Progress / On Hold (`TICKET_STATUS_CHANGED`) | Requester | Assignee + TL + MGR + Custom CC | Same | Same | `buildRequesterOnlyRecipients` | ✅ |
| Resolved (`TICKET_RESOLVED`) | Requester | Assignee + TL + MGR + Custom CC | Same | Same | same | ✅ |
| Requester confirmation required | — | — | **Not implemented** | — | — | No such event |
| Closed (`TICKET_CLOSED`) | Requester | Assignee + TL + MGR + Custom CC | Same | Same | same | ✅ |
| Reopened (`TICKET_REOPENED`) | Requester | Assignee + TL + MGR + Custom CC | Same | Same | same | ✅ (reopen reason not in email body) |
| Requester edited ticket (`TICKET_UPDATED`) | Requester | Assignee + TL + MGR + Custom CC | Same | Same | same | ✅ |
| Public comment (`TICKET_COMMENT_ADDED`) | Assignee | Requester + TL + MGR + Custom CC | Same | Same | `buildAssignedOrCommentRecipients` | ⚠️ unassigned ticket → no To → **no email to anyone** |
| Department transfer (`TICKET_DEPARTMENT_TRANSFERRED`) | Requester (+ assignee, always cleared) | New dept TL + MGR + Custom CC | Same | Same | `buildStandardRecipients` | ✅ old department not notified |
| Password reset (`PASSWORD_RESET_REQUESTED`) | The user | — | Same | — | `auth.service.js` | ✅ |
| Internal note, Admin bulk update, unassign, staff edit of priority/department | — | — | **No email** | — | — | By omission |

Deduplication: yes (ids, then addresses; To wins over CC). Missing/invalid address: that
recipient is silently dropped; if every To recipient is dropped, **nothing is sent**.
Missing template: a generic fallback body is still sent (ticket events).

---

## 19. Current Requester-Only Notification Trace (ticket 2600003)

### Database state (local `helpdesk`, read-only)

| Item | Value |
|---|---|
| Ticket | 2600003, created 2026-10-09 07:34:52 UTC, OPEN, High |
| To-department | **M365** |
| Requester | Sankaranarayanan T (EMPLOYEE, active, `s***@powercen.com`) |
| Assignee | none |
| Custom CC | **Pavithran M** (TEAMLEAD of Hardware, active, `p***@powercen.com`) |
| `Ticket.managerId` | null |
| M365 `UserDepartmentAccess` rows (Team Leads / Managers) | **0** |
| `Notification` rows for the ticket | exactly **one**: `TICKET_CREATED → Sankaranarayanan T` |

### Execution path

1. `POST /api/v1/tickets` → `ticket.controller.create` → `ticketService.createTicket`.
2. `createTicket` loads `getActiveDepartmentTeamLeads(M365)` and `getActiveDepartmentManagers(M365)`
   — both return **[]** (no `UserDepartmentAccess` rows). Creation is **not** blocked
   (unlike department transfer, which rejects a department without management).
3. `buildCreatedRecipients` returns `userIds: []`,
   `ccUserIds: [requester, Pavithran M (Custom CC)]`.
4. The call site (`ticket.service.js`, `createTicket`) applies the fallback:
   ```js
   userIds:   created.userIds.length ? created.userIds : [user.id],   // -> [requester]
   ccUserIds: created.userIds.length ? created.ccUserIds : [],         // -> []  (Custom CC dropped)
   ```
5. `notify` creates the single bell row for the requester (matches the DB) and sends one Graph
   message: **To = requester, CC = none**, body = the `TICKET_CREATED` template
   ("…has been raised for the M365 department and requires review and assignment").

### Answers

| Question | Answer |
|---|---|
| Endpoint / function | `POST /api/v1/tickets` → `createTicket` → `notificationService.notify` |
| Who builds To/CC | `recipientBuilder.js#buildCreatedRecipients`, then **overridden** by the fallback at the `createTicket` call site |
| Why the requester is To | M365 has **no active Team Lead** mapped, so the fallback substitutes the ticket creator |
| Requester intended as primary? | Only as the documented fallback; normally the requester is **CC** |
| Should TL/Manager receive it? | Yes, TL in To and Managers in CC — but none are mapped to M365 in this database |
| Manager address source | `UserDepartmentAccess` → `User` → Entra lookup (not department config, not `Ticket.managerId`) |
| Logic that replaces manager with requester | Yes — the fallback above (by design, not an accidental swap) |
| Custom CC included? | **No — the fallback discards it** (Pavithran M was not emailed) |
| List or single address? | A list (`to: [...]`, `cc: [...]`) |
| Overwritten later? | No; only the call-site fallback alters it |
| Different logic per event? | Yes — five builder shapes (see §18) |

The Outlook "To: Sankaranarayanan T" view is complete for this message: with `ccUserIds: []`
there is no CC, and BCC is not implemented.

---

## 20. Git Regression and Last Known Working Version Analysis

`TICKET_CREATED` recipient rules across history (`git show <commit>:server/src/services/ticket.service.js`):

| Commit | Date | Rule | No-manager case |
|---|---|---|---|
| `c024934` | 2026-09-20 | Two separate emails: one **To requester** (confirmation), one **To department manager** (`Ticket.managerId`, legacy `User.isManager` + `departmentId`) | Requester email still sent |
| `1459809` | 2026-09-23 | One email: **To manager, CC requester** | **To requester only** (fallback introduced) |
| `501313f` | 2026-09-26 | Four-role model: **To all active TL** (via `UserDepartmentAccess`), **CC requester + MGR (+ Custom CC)** | **To requester, CC dropped** |
| `efd0086` | 2026-09-27 | Unchanged recipients (attachments + Custom CC wiring) | Same |
| `HEAD` `58de9b4` | 2026-10-07 | Unchanged | Same |

Findings:

- **No code change after `501313f` altered `TICKET_CREATED` recipients.** Commits since
  (`efd0086`, `06f7f8c`, `bf0036c`, `0a18f5b`, `91a8bb7`, `58de9b4`) do not change this logic.
- **`501313f` changed the data source** for department management from legacy
  `User.isManager` / `User.departmentId` to `UserDepartmentAccess`. Its migration
  (`20260926000000_four_role_model_and_user_department_access`) renames the old
  `agent_department_access` table and trims rows; **it does not create mappings from the legacy
  `isManager` flags**. A department is notified only if an admin has mapped a Team Lead/Manager
  to it under the new model.
- "Last known working version": for **a department with a mapped Team Lead**, every commit from
  `501313f` to `HEAD` routes the new-ticket email to the Team Leads. There is no commit at which
  a department **without** mapped management emailed anyone other than the requester
  (except `c024934`, where the requester and a legacy manager got separate emails).
- **Conclusion:** the change in behaviour is explained by **data (missing M365 department
  management mapping in this database), not by a code regression.** Confidence: high for the
  local environment.

---

## 21. Department Manager and Team-Lead Resolution

| Check | Result (local `helpdesk` DB) |
|---|---|
| M365 record | `departments` row "M365" (id `cmul3s6r…`), matched by **id** (`Ticket.toDepartmentId`), not by name |
| Team Lead / Manager mapping | `user_department_access` rows for M365: **0** |
| Departments with any mapping | **Only Hardware (1 row: Pavithran M, TEAMLEAD).** Administration, BI/Copilot, Cloud, Corporate, HR, M365, Operations, Sales, Security: **0** |
| Legacy `isManager` users in M365 | 0 (only one EMPLOYEE has `departmentId` = M365) |
| Requester/manager fields swapped? | No |
| Failed lookup falls back to requester? | Yes — explicitly, when the TL list is empty (§19) |
| Stale config / other DB? | The server and the UI both use `DATABASE_URL` from `server/.env` (database `helpdesk`); no caching of recipients |

**Live environment (unverified):** an earlier screenshot of live ticket 2600008 showed M365 with
Team Leads *Ashok Kumar M, Devaraj Y* and Manager *S Mohankumar*. If 2600003's email came from
the live server, the cause would differ; but the local database's 2600003 matches every detail
in the reported email (M365, High, OPEN, summary "test", requester, single bell row), so the
email is attributed to the **local** environment.

---

## 22. Expected Versus Actual Recipient Comparison

| Situation | Matches? | Evidence |
|---|---|---|
| A. Requester should get it and the manager too | Partly — the requester is normally **CC** | `buildCreatedRecipients` |
| B. Manager/TL in To, requester and others in CC | **Yes — the intended rule** | `recipientBuilder.js` |
| C. Requester is the only intended recipient | No (only as fallback) | — |
| D. Others receive a separate notification for the same event | No (one message since `1459809`) | Git history |
| **E. Resolution finds nobody and silently falls back to the requester** | **Yes — this is what happened** | 0 M365 mappings; one bell row; fallback code |
| F. Correct recipients configured but not delivered | No evidence (none were configured) | — |

**Actual behaviour = E**, with the extra side effect that the **Custom CC recipient
(Pavithran M) was dropped**.

---

## 23. Regression Findings and Confidence Levels

| # | Finding | Type | Confidence |
|---|---|---|---|
| R1 | M365 (and 8 other departments) have no `UserDepartmentAccess` Team Lead/Manager in the local DB, so `TICKET_CREATED` falls back to To = requester | Data/configuration — **confirmed cause** | High |
| R2 | The fallback **drops Managers and Custom CC** (`ccUserIds: []`), so Pavithran M was not emailed for 2600003 | Code defect (since `501313f`) — **confirmed** | High |
| R3 | `createTicket` accepts a department with no active management, while `transferDepartment` rejects one — so tickets can be raised into an unmonitored department | Code inconsistency — confirmed | High |
| R4 | The `501313f` migration did not create mappings from legacy `isManager` data; any environment not re-mapped by an admin loses department notifications | Migration gap — **hypothesis** for other environments (local DB has no legacy managers to compare) | Medium |
| R5 | The requester receives the reviewer-oriented template text ("requires review and assignment") in the fallback | Content issue — confirmed | High |
| R6 | Comments on unassigned tickets send no email to anyone | Code behaviour — confirmed (unrelated to 2600003) | High |
| — | No commit after `501313f` changed new-ticket recipients | — | High |

---

## 24. Recommended Minimal Fix

Not applied (read-only phase). In order of priority:

1. **Data (no code):** in Admin → Departments, map at least one active Team Lead (and the
   Managers) to M365 and every other department. This alone restores To = Team Leads,
   CC = requester + Managers + Custom CC.
2. **Code — keep CC in the fallback** (`ticket.service.js`, `createTicket`):
   ```js
   ccUserIds: created.userIds.length
     ? created.ccUserIds
     : created.ccUserIds.filter((id) => id !== user.id), // keep Managers + Custom CC
   ```
   and, preferably, promote active Managers to To when there is no Team Lead
   (To = Managers if any, else requester).
3. **Optional guard:** make `createTicket` reject (or warn about) a department with no active
   Team Lead or Manager, matching `transferDepartment`.
4. **Visibility:** log a warning when the fallback path is taken, so missing mappings are noticed.

---

## 25. Recipient Verification and Regression Test Checklist

Automated tests (mock `notification.service`/`email.service`; isolated test data; never real email):

- [ ] Department with TLs + MGRs + 2 Custom CC → To = all TLs, CC = requester + MGRs + both CCs
- [ ] Department with **no TL but a Manager** → expected per chosen fix (Manager To, CC retained)
- [ ] Department with **no management** → To = requester, **Custom CC still present** (after fix)
- [ ] Requester who is also a TL → appears once (To), not in CC
- [ ] Inactive TL / inactive CC user → excluded, others still sent
- [ ] Requester with no resolvable address and empty TL list → no send, no crash, ticket created
- [ ] `sendMail` rejects → ticket creation still succeeds, error logged
- [ ] M365 mapping → expected TL ids resolved by department **id**
- [ ] Lifecycle: assigned / reassigned / self-assigned / status / resolved / closed / reopened /
      updated / comment / transfer each produce the To/CC in §18
- [ ] No address appears in both To and CC

Manual verification (per environment):

1. Admin → Departments → M365: confirm the mapped Team Leads/Managers.
2. Raise a test ticket to M365 with one Custom CC.
3. In `helpdesk@` → Sent Items, open the message and check **To** (Team Leads) and **CC**
   (requester, Managers, Custom CC).
4. Repeat for assignment, a status change, a public comment, and closure.
5. For live, use Exchange message trace for delivery confirmation.

---

## Final Answers

1. **Who should receive each notification?** See §18. New ticket: To = department Team Leads;
   CC = requester + Managers + Custom CC. Later events: To = requester (status/resolve/close/
   reopen/update/self-assign/transfer) or assignee (assign/reassign/comment), CC = the rest.
2. **Who actually receives them?** The same, except for the two gaps below.
3. **Why did 2600003 go to the requester?** M365 has no active Team Lead mapped
   (`user_department_access` is empty for M365 in this database), so `createTicket`'s fallback
   sent To = requester.
4. **Why are others missing?** No Team Lead/Manager is mapped to M365, and the fallback sets
   CC to empty, which also dropped the Custom CC recipient (Pavithran M).
5. **What changed?** Commit `501313f` (2026-09-26) moved department management to
   `UserDepartmentAccess` and introduced the CC-dropping fallback; no later commit changed
   new-ticket recipients. The visible change comes from the missing department mappings.
6. **Exact cause:** data — the M365 mapping is absent (confirmed). Code contributor — the
   fallback at `createTicket` (`ccUserIds: created.userIds.length ? created.ccUserIds : []`),
   introduced in `501313f` (confirmed for the dropped Custom CC).
7. **Smallest safe fix:** map Team Leads/Managers to every department (no code). Then keep
   Managers and Custom CC in the fallback (one-line change, §24).
8. **How to verify:** the checklist in §25 — Sent Items / message trace for a test ticket per
   department, plus mocked-transport tests for every event.
