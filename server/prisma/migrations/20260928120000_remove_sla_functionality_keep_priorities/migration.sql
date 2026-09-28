-- Removes SLA functionality entirely while preserving Priority and every
-- existing ticket's priority relationship. Priority (id/name/level/color)
-- and Ticket.priorityId are completely untouched by this migration.

-- 1. Drop the SLA policy table and its FK to priorities.
ALTER TABLE "sla_policies" DROP CONSTRAINT IF EXISTS "sla_policies_priorityId_fkey";
DROP TABLE IF EXISTS "sla_policies";

-- 2. Drop the SLA-only Ticket columns. `dueAt` (the SLA-derived resolution
--    deadline) and `firstResponseAt` (SLA first-response tracking, never
--    read anywhere in the application) are removed; `resolvedAt`/`closedAt`
--    are kept — they are plain lifecycle timestamps used by the dashboard's
--    trend chart, not SLA configuration.
ALTER TABLE "tickets" DROP COLUMN IF EXISTS "dueAt";
ALTER TABLE "tickets" DROP COLUMN IF EXISTS "firstResponseAt";
