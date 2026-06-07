-- AlterTable
ALTER TABLE "ChatRoom" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatRoom" ADD COLUMN "pinnedAt" DATETIME;

-- CreateIndex
CREATE INDEX "ChatRoom_isPinned_pinnedAt_idx" ON "ChatRoom"("isPinned", "pinnedAt");