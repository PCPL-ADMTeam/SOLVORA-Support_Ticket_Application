-- Removes the obsolete department-prefix ticket-numbering fields. Ticket
-- numbers have not been generated from these since migration
-- 20260926120000_ticket_number_problem_summary introduced the global
-- Ticket.seq-derived ticketNumber (see ticket.service.js#createTicket /
-- utils/ticketNumber.js#buildTicketNumber) — ticketPrefix/ticketSequence
-- have been inert identity-only fields ever since, read only by the Admin
-- Department UI's now-removed "Ticket Prefix" field and "Prefix: X" display
-- chip. Dropping the columns also drops the unique index tied to
-- ticketPrefix (departments_ticketPrefix_key) automatically. No other
-- Department column, no Ticket data, and no existing ticketNumber value is
-- touched by this migration — every existing department row and ticket
-- row is preserved as-is.
ALTER TABLE "departments" DROP COLUMN IF EXISTS "ticketPrefix";
ALTER TABLE "departments" DROP COLUMN IF EXISTS "ticketSequence";
