-- CreateTable
CREATE TABLE "coordinator_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatRoomId" TEXT NOT NULL,
    "triggerMessageId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "targetAgentIds" TEXT,
    "content" TEXT,
    "forwardVerbatim" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "sourceAgentId" TEXT,
    "sourceIsHuman" BOOLEAN NOT NULL DEFAULT true,
    "sourceContent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coordinator_logs_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "coordinator_logs_triggerMessageId_fkey" FOREIGN KEY ("triggerMessageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "coordinator_logs_sourceAgentId_fkey" FOREIGN KEY ("sourceAgentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "coordinator_logs_triggerMessageId_key" ON "coordinator_logs"("triggerMessageId");

-- CreateIndex
CREATE INDEX "coordinator_logs_chatRoomId_idx" ON "coordinator_logs"("chatRoomId");

-- CreateIndex
CREATE INDEX "coordinator_logs_createdAt_idx" ON "coordinator_logs"("createdAt");
