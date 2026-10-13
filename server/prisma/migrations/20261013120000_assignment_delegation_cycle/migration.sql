-- Assignment workflow: delegation cycle, one-delegation-per-cycle flag and an
-- optimistic-concurrency version on tickets, plus structured metadata on
-- ticket history. Additive only: existing tickets get cycle 1, no delegation
-- used, version 0; existing history rows keep metadata NULL.

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "assignmentCycle" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "delegationUsed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "assignmentVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ticket_history" ADD COLUMN "metadata" JSONB;
