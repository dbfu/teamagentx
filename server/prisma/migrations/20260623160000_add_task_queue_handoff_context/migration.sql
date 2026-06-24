-- Persist structured assistant handoff lineage/batch context with queued work.
ALTER TABLE "TaskQueue" ADD COLUMN "handoffContext" TEXT;
