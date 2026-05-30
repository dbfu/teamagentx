PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ChatRoomAgent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatRoomId" TEXT NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "injectGroupHistory" BOOLEAN NOT NULL DEFAULT false,
    "customWorkDir" TEXT,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInjectedMessageId" TEXT,
    FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_ChatRoomAgent" (
    "id",
    "chatRoomId",
    "userId",
    "agentId",
    "role",
    "injectGroupHistory",
    "customWorkDir",
    "joinedAt",
    "lastReadAt",
    "lastInjectedMessageId"
)
SELECT
    "id",
    "chatRoomId",
    "userId",
    "agentId",
    "role",
    false,
    "customWorkDir",
    "joinedAt",
    "lastReadAt",
    "lastInjectedMessageId"
FROM "ChatRoomAgent";

DROP TABLE "ChatRoomAgent";
ALTER TABLE "new_ChatRoomAgent" RENAME TO "ChatRoomAgent";

CREATE UNIQUE INDEX "ChatRoomAgent_chatRoomId_userId_key" ON "ChatRoomAgent"("chatRoomId" ASC, "userId" ASC);
CREATE UNIQUE INDEX "ChatRoomAgent_chatRoomId_agentId_key" ON "ChatRoomAgent"("chatRoomId" ASC, "agentId" ASC);
CREATE INDEX "ChatRoomAgent_chatRoomId_idx" ON "ChatRoomAgent"("chatRoomId" ASC);

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
