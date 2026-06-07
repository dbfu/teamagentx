-- AlterTable
ALTER TABLE "ChatRoom" ADD COLUMN "isCollapsed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatRoom" ADD COLUMN "collapsedAt" DATETIME;

-- CreateIndex
CREATE INDEX "ChatRoom_isCollapsed_idx" ON "ChatRoom"("isCollapsed");
