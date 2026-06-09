-- CreateTable
CREATE TABLE "WorkbenchTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "chatRoomId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "dueText" TEXT,
    "expectedOutput" TEXT,
    "note" TEXT,
    "dispatchMessageId" TEXT,
    "createdBy" TEXT,
    "dispatchedAt" DATETIME,
    "completedAt" DATETIME,
    "lastActivityAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkbenchTask_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkbenchTask_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WorkbenchTask_createdBy_createdAt_idx" ON "WorkbenchTask"("createdBy", "createdAt");

-- CreateIndex
CREATE INDEX "WorkbenchTask_chatRoomId_idx" ON "WorkbenchTask"("chatRoomId");

-- CreateIndex
CREATE INDEX "WorkbenchTask_status_idx" ON "WorkbenchTask"("status");

-- CreateIndex
CREATE INDEX "WorkbenchTask_dispatchMessageId_idx" ON "WorkbenchTask"("dispatchMessageId");
