-- Removes the old per-department Issue selection from Ticket (replaced by
-- the free-text Problem Summary field) and switches ticketNumber to a
-- purely numeric, globally unique scheme derived from the already-unique
-- Ticket.seq autoincrement column. The `issues` table itself is left in
-- place (dormant) — only the FK/columns on `tickets` are removed.

-- 1. Drop the tickets -> issues relationship.
ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_issueId_fkey";
DROP INDEX IF EXISTS "tickets_issueId_idx";
ALTER TABLE "tickets" DROP COLUMN IF EXISTS "issueId";
ALTER TABLE "tickets" DROP COLUMN IF EXISTS "customIssueText";

-- 2. Rename the old rich-text description column to problemSummary,
--    preserving every existing ticket's content byte-for-byte.
ALTER TABLE "tickets" RENAME COLUMN "description" TO "problemSummary";

-- 3. Backfill every existing ticket's ticketNumber to the new numeric
--    scheme: 2600000 + seq (e.g. seq=27001 -> "2627001"). Safe as a single
--    statement with no collisions, since seq is already globally unique
--    per ticket and 2600000+seq is therefore also unique; Postgres'
--    sequence backing `seq` continues from where it left off, so no
--    future ticket can ever collide with a backfilled value either.
UPDATE "tickets" SET "ticketNumber" = (2600000 + "seq")::text;
