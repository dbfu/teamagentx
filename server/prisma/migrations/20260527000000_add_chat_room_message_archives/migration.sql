CREATE TABLE "ChatRoomMessageArchive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatRoomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "archivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatRoomMessageArchive_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'MESSAGE',
    "content" TEXT NOT NULL,
    "time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "agentId" TEXT,
    "chatRoomId" TEXT NOT NULL,
    "replyMessageId" TEXT,
    "isHuman" BOOLEAN NOT NULL DEFAULT true,
    "executionRecordId" TEXT,
    "archiveId" TEXT,
    "executionDuration" INTEGER,
    "totalTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("archiveId") REFERENCES "ChatRoomMessageArchive" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("replyMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Message" (
    "id",
    "type",
    "content",
    "time",
    "userId",
    "agentId",
    "chatRoomId",
    "replyMessageId",
    "isHuman",
    "executionRecordId",
    "executionDuration",
    "totalTokens",
    "cacheReadTokens",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "type",
    "content",
    "time",
    "userId",
    "agentId",
    "chatRoomId",
    "replyMessageId",
    "isHuman",
    "executionRecordId",
    "executionDuration",
    "totalTokens",
    "cacheReadTokens",
    "createdAt",
    "updatedAt"
FROM "Message";

DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE INDEX "ChatRoomMessageArchive_chatRoomId_archivedAt_idx" ON "ChatRoomMessageArchive"("chatRoomId", "archivedAt");
CREATE INDEX "ChatRoomMessageArchive_createdBy_idx" ON "ChatRoomMessageArchive"("createdBy");
CREATE INDEX "Message_time_idx" ON "Message"("time");
CREATE INDEX "Message_chatRoomId_idx" ON "Message"("chatRoomId");
CREATE INDEX "Message_agentId_idx" ON "Message"("agentId");
CREATE INDEX "Message_userId_idx" ON "Message"("userId");
CREATE INDEX "Message_executionRecordId_idx" ON "Message"("executionRecordId");
CREATE INDEX "Message_archiveId_idx" ON "Message"("archiveId");
