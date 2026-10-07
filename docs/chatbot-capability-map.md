# Chatbot capability map

Generated from `server/src/chatbot/capabilityMap.js` by `capabilityMap.test.js`. Every phrase listed here is tested for every allowed role.

## DASHBOARD_SUMMARY

The signed-in user's dashboard numbers (Raised by me / Assigned to me, status and priority), last 30 days by default.

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: dashboard.service.getStats (via get_my_dashboard)
- Details read from the message: dateRange
- Asks when unclear: None: both dashboard tabs are shown when the question does not say which.
- Example phrasings:
  - `give me my dashboard summary` -> `dashboard_summary`
  - `show my ticket statistics` -> `dashboard_summary`
  - `show my dashboard` -> `dashboard_summary`
  - `my ticket stats` -> `dashboard_summary`
  - `show my tickets by priority` -> `dashboard_summary`
  - `show my dashboard summary for the last 7 days` -> `dashboard_summary`

## DASHBOARD_COUNT

How many tickets (optionally by status or priority) the user raised and/or is assigned.

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: dashboard.service.getStats (via get_my_dashboard)
- Details read from the message: status, priority, dateRange, scope
- Asks when unclear: None: answers per dashboard tab.
- Example phrasings:
  - `how many tickets do I have` -> `dashboard_summary`
  - `how many tickets did I raise` -> `dashboard_summary`
  - `how many tickets are assigned to me` -> `dashboard_summary`
  - `how many resolved tickets do I have` -> `dashboard_summary`
  - `how many high priority tickets do I have` -> `dashboard_summary`
  - `how many tickets have I created in the last 7 days` -> `dashboard_summary`

## RAISED_TICKETS

Tickets the user raised.

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: ticket search (scoped) with requester = the signed-in user
- Details read from the message: status, priority, department, dateRange
- Asks when unclear: None.
- Example phrasings:
  - `show tickets I raised` -> `list_tickets`
  - `tickets I created` -> `list_tickets`
  - `my raised tickets` -> `list_tickets`
  - `show tickets raised by me` -> `list_tickets`
  - `what tickets did I raise` -> `list_tickets`
  - `what support requests did I create` -> `list_tickets`
  - `show me the raised tickets` -> `list_tickets`
  - `list created tickets` -> `list_tickets`

## ASSIGNED_TICKETS

Tickets assigned to the user.

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: ticket search (scoped) with assignee = the signed-in user
- Details read from the message: status, priority, department, dateRange
- Asks when unclear: None.
- Example phrasings:
  - `show tickets assigned to me` -> `list_tickets`
  - `what tickets am I handling` -> `list_tickets`
  - `show my assigned tickets` -> `list_tickets`
  - `which tickets are currently with me` -> `list_tickets`
  - `what tickets do I need to work on` -> `list_tickets`
  - `tickets I'm responsible for` -> `list_tickets`
  - `show me the assigned tickets` -> `list_tickets`

## TICKET_SEARCH

Tickets by status, priority, department, person or date, inside what the user may see.

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: ticket search (scoped, ticket.service scope rules)
- Details read from the message: status, priority, department, assignee, requester, dateRange, searchText
- Asks when unclear: Which person, when several match.
- Example phrasings:
  - `show high priority tickets in Hardware` -> `list_tickets`
  - `show tickets assigned to Manoj Kumar R` -> `list_tickets`
  - `show tickets raised by Jamie User` -> `list_tickets`
  - `show resolved tickets in BI/Copilot` -> `list_tickets`
  - `show tickets about printer` -> `list_tickets`
  - `show open tickets from last week` -> `list_tickets`
  - `Tickets from September 15 to September 20` -> `list_tickets`
  - `show me the tickets from sep15 to sep20` -> `list_tickets`
  - `tickets between 1 oct and 5 oct` -> `list_tickets`
  - `show tickets created since September 20` -> `list_tickets`

## TICKET_DETAILS

One ticket's card, status, requester and assignee.

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: ticket.service (assertCanView) via get_authorized_ticket
- Details read from the message: ticketNumber
- Asks when unclear: Which ticket number.
- Example phrasings:
  - `show ticket 2600007` -> `find_ticket`
  - `tell me about ticket 2600007` -> `find_ticket`
  - `what's the status of ticket 2600007` -> `find_ticket`
  - `who is handling ticket 2600007` -> `find_ticket`
  - `who raised ticket 2600007` -> `find_ticket`
  - `ticket 2600007 details` -> `find_ticket`

## TICKET_SUMMARY

A summary of one ticket: facts, latest update, what is pending.

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: summarize_authorized_ticket
- Details read from the message: ticketNumber
- Asks when unclear: Which ticket number.
- Example phrasings:
  - `summarize ticket 2600007` -> `summarize_ticket`
  - `give me a summary of ticket 2600007` -> `summarize_ticket`
  - `ticket 2600007 overview` -> `summarize_ticket`
  - `brief me on ticket 2600007` -> `summarize_ticket`
  - `what is pending on ticket 2600007` -> `pending_actions`

## TICKET_HISTORY

A ticket's recorded history (assignments, status changes, comments).

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: TicketHistory via get_authorized_ticket_history
- Details read from the message: ticketNumber
- Asks when unclear: Which ticket number.
- Example phrasings:
  - `show the history of ticket 2600007` -> `ticket_history`
  - `what happened to ticket 2600007` -> `latest_update`
  - `ticket 2600007 timeline` -> `ticket_history`
  - `show the audit trail for ticket 2600007` -> `ticket_history`
  - `what changed on ticket 2600007` -> `ticket_history`
  - `show the latest update on ticket 2600007` -> `latest_update`

## TICKET_DATES

When a ticket was created or last updated (UTC).

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: get_authorized_ticket (createdAt / updatedAt)
- Details read from the message: ticketNumber
- Asks when unclear: Which ticket number.
- Example phrasings:
  - `when was ticket 2600007 created` -> `ticket_dates`
  - `ticket 2600007 is created at ?` -> `ticket_dates`
  - `what is the creation date of ticket 2600007` -> `ticket_dates`
  - `when did ticket 2600007 get raised` -> `ticket_dates`
  - `when was ticket 2600007 last updated` -> `ticket_dates`
  - `when the ticket is created ?` -> `ticket_dates`

## TICKET_REASONS

The recorded closed reason, resolution notes, on-hold reason or reopen note: for one ticket, or for each resolved / closed / reopened ticket in a list. The text is shown in a card, never in the message.

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: Ticket.closedReason / resolutionNotes / onHoldReason and TicketHistory via get_authorized_ticket_reasons
- Details read from the message: ticketNumber, status
- Asks when unclear: Which ticket number (for a single ticket).
- Example phrasings:
  - `why was ticket 2600007 closed` -> `ticket_reasons`
  - `show the closed reason of ticket 2600007` -> `ticket_reasons`
  - `what are the resolution notes for ticket 2600007` -> `ticket_reasons`
  - `why was ticket 2600007 resolved` -> `ticket_reasons`
  - `why was ticket 2600007 reopened` -> `ticket_reasons`
  - `show me the closed ticket reasons` -> `list_tickets`
  - `show me the resolved ticket reasons?` -> `list_tickets`
  - `show the reopened ticket reasons` -> `list_tickets`

## TICKET_COMMENTS

The public comments on a ticket (internal notes are never shown).

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: TicketComment via get_authorized_ticket_comments
- Details read from the message: ticketNumber
- Asks when unclear: Which ticket number.
- Example phrasings:
  - `show comments on ticket 2600007` -> `ticket_comments`
  - `what was the latest comment on ticket 2600007` -> `ticket_comments`
  - `who commented on ticket 2600007` -> `ticket_comments`
  - `ticket 2600007 comments` -> `ticket_comments`
  - `list the comments for ticket 2600007` -> `ticket_comments`

## TICKET_ATTACHMENTS

Attachment names and sizes on a ticket (never file contents or paths).

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: TicketAttachment via get_authorized_ticket_attachments
- Details read from the message: ticketNumber
- Asks when unclear: Which ticket number.
- Example phrasings:
  - `does ticket 2600007 have attachments` -> `ticket_attachments`
  - `show attachments for ticket 2600007` -> `ticket_attachments`
  - `how many attachments are there on ticket 2600007` -> `ticket_attachments`
  - `list files on ticket 2600007` -> `ticket_attachments`
  - `ticket 2600007 attachments` -> `ticket_attachments`

## TICKET_PEOPLE

The managers / team leads of the department a ticket belongs to.

- Roles: ADMIN, MANAGER, TEAMLEAD
- Source: get_department_members for the ticket's department
- Details read from the message: ticketNumber, role
- Asks when unclear: Which ticket number.
- Example phrasings:
  - `who is the manager for ticket 2600007` -> `ticket_people`
  - `who is the team lead for ticket 2600007` -> `ticket_people`
  - `who are the managers of ticket 2600007` -> `ticket_people`
  - `who are the team leads on ticket 2600007` -> `ticket_people`
  - `which manager handles ticket 2600007` -> `ticket_people`

## DEPARTMENT_PEOPLE

Managers, team leads or employees of a department (only roles asked for).

- Roles: ADMIN, MANAGER, TEAMLEAD
- Source: get_department_members (scoped to the user's departments)
- Details read from the message: department, role
- Asks when unclear: Which department.
- Example phrasings:
  - `who is the manager in BI/Copilot` -> `people_directory`
  - `who are the team leads in Hardware` -> `people_directory`
  - `show employees in Hardware` -> `people_directory`
  - `who handles Hardware` -> `people_directory`
  - `how many employees are in Cloud` -> `people_directory`
  - `who is the team lead for Hardware` -> `people_directory`

## NOTIFICATION_LIST

The user's own in-app notifications (the bell).

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: notification.service.listForUser (via get_my_notifications)
- Details read from the message: ticketNumber, date
- Asks when unclear: None.
- Example phrasings:
  - `show my notifications` -> `notifications`
  - `show my latest notifications` -> `notifications`
  - `what notifications did I receive today` -> `notifications`
  - `show notifications related to ticket 2600007` -> `notifications`
  - `list my notifications` -> `notifications`

## NOTIFICATION_UNREAD

Unread notifications and the unread count.

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: notification.service.countUnread / listForUser
- Details read from the message: none
- Asks when unclear: None.
- Example phrasings:
  - `show unread notifications` -> `notifications`
  - `do I have unread notifications` -> `notifications`
  - `how many unread notifications do I have` -> `notifications`
  - `any new notifications` -> `notifications`
  - `how many notifications do I have` -> `notifications`

## NOTIFICATION_ACTIONS

Mark one / all notifications read, or clear them (preview and confirm first).

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: notification.service.markRead / markAllRead / clearAll
- Details read from the message: none
- Asks when unclear: Confirmation button.
- Example phrasings:
  - `mark all notifications as read` -> `admin_action`
  - `mark all my notifications as read` -> `admin_action`
  - `read all my notifications` -> `admin_action`
  - `clear all my notifications` -> `admin_action`
  - `clear notifications` -> `admin_action`
  - `mark the latest notification as read` -> `admin_action`

## ADD_COMMENT

Add a public comment to a ticket (preview and confirm first).

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: ticket.service.addComment
- Details read from the message: ticketNumber, comment
- Asks when unclear: What the comment should say.
- Example phrasings:
  - `add a comment on ticket 2600007: working on it` -> `admin_action`
  - `add a comment "working on it" in the ticket 2600007` -> `admin_action`
  - `comment "on it" on ticket 2600007` -> `admin_action`
  - `add comment to ticket 2600007 saying I will call them` -> `admin_action`
  - `add a comment on ticket 2600007` -> `admin_action`

## ASSIGN_TICKET

Assign or reassign a ticket (Manager / Team Lead of the ticket's department; preview and confirm first).

- Roles: MANAGER, TEAMLEAD
- Source: ticket.service.updateTicket (assignee)
- Details read from the message: ticketNumber, assignee
- Asks when unclear: Which person, when several match.
- Example phrasings:
  - `assign ticket 2600007 to Manoj Kumar R` -> `admin_action`
  - `reassign ticket 2600007 to Manoj Kumar R` -> `admin_action`
  - `please assign ticket 2600007 to Manoj` -> `admin_action`

## CREATE_TICKET

Raise a ticket conversationally: title, priority, department, CC, problem summary and files are collected, reviewed, and created by the Raise a Ticket service after confirmation. Administrators cannot raise tickets.

- Roles: MANAGER, TEAMLEAD, EMPLOYEE
- Source: ticket.service.createTicket (same call as the Raise a Ticket page)
- Details read from the message: department, title, description, priority
- Asks when unclear: Subject, description, department.
- Example phrasings:
  - `raise a ticket for Finance: printer broken` -> `ticket_draft`
  - `create a ticket for Demo laptop to hardware team` -> `ticket_draft`
  - `raise a new ticket to hardware department that I need a demo laptop` -> `ticket_draft`
  - `raise a ticket` -> `ticket_draft`
  - `I want to create a support ticket` -> `ticket_draft`
  - `can you raise a ticket for me?` -> `ticket_draft`
  - `I have a problem` -> `ticket_draft`
  - `open a support ticket` -> `ticket_draft`

## TRANSFER_TICKET

Transfer a ticket to another department with a reason (the ticket service decides who may; preview and confirm first). Administrators cannot transfer.

- Roles: MANAGER, TEAMLEAD, EMPLOYEE
- Source: ticket.service.transferDepartment
- Details read from the message: ticketNumber, department, reason
- Asks when unclear: The reason, when it is not given.
- Example phrasings:
  - `transfer ticket 2600007 to Finance because it is a billing issue` -> `admin_action`
  - `transfer ticket 2600007 to the Hardware team since they own laptops` -> `admin_action`
  - `please transfer ticket 2600007 to Cloud department because it needs their access` -> `admin_action`
  - `transfer ticket 2600007 to Finance` -> `admin_action`

## STATUS_UPDATE

Change a ticket's status (the backend decides who may; preview and confirm first).

- Roles: MANAGER, TEAMLEAD, EMPLOYEE
- Source: ticket.service.updateTicket (status)
- Details read from the message: ticketNumber, status
- Asks when unclear: Which status.
- Example phrasings:
  - `mark ticket 2600007 as in progress` -> `admin_action`
  - `set ticket 2600007 to on hold` -> `admin_action`
  - `resolve ticket 2600007` -> `admin_action`
  - `reopen ticket 2600007` -> `admin_action`
  - `close ticket 2600007` -> `admin_action`

## WHATS_NEW

A short digest for the signed-in user: unread notifications, recently updated tickets, tickets assigned to them, and (for staff) new and unassigned tickets in their departments. Last 7 days unless a range is given.

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: get_my_notifications + search_authorized_tickets (the same scoped tools)
- Details read from the message: dateRange
- Asks when unclear: None.
- Example phrasings:
  - `what's new` -> `whats_new`
  - `what new` -> `whats_new`
  - `whats new` -> `whats_new`
  - `anything new?` -> `whats_new`
  - `what did I miss` -> `whats_new`
  - `catch me up` -> `whats_new`
  - `what's new today` -> `whats_new`

## HELP

What the assistant can do.

- Roles: ADMIN, MANAGER, TEAMLEAD, EMPLOYEE
- Source: portal capabilities
- Details read from the message: none
- Asks when unclear: None.
- Example phrasings:
  - `hi` -> `help`
  - `help` -> `help`
  - `what can you do` -> `help`
  - `hello` -> `help`
  - `good morning` -> `help`

