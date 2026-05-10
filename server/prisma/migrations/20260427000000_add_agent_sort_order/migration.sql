-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "sortOrder" INTEGER DEFAULT 0;

-- CreateIndex
CREATE INDEX "Agent_sortOrder_idx" ON "Agent"("sortOrder");