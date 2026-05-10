-- Store rolling per-agent room summaries used to keep group history prompts short.

CREATE TABLE "AgentRoomMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatRoomId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "coveredMessageId" TEXT,
    "coveredMessageTime" DATETIME,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "compactStatus" TEXT NOT NULL DEFAULT 'idle',
    "compactStartedAt" DATETIME,
    "compactError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentRoomMemory_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentRoomMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentRoomMemory_coveredMessageId_fkey" FOREIGN KEY ("coveredMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentRoomMemory_chatRoomId_agentId_key" ON "AgentRoomMemory"("chatRoomId", "agentId");
CREATE INDEX "AgentRoomMemory_chatRoomId_idx" ON "AgentRoomMemory"("chatRoomId");
CREATE INDEX "AgentRoomMemory_agentId_idx" ON "AgentRoomMemory"("agentId");
CREATE INDEX "AgentRoomMemory_compactStatus_idx" ON "AgentRoomMemory"("compactStatus");
