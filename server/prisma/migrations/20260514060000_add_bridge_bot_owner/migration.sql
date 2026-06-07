PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_BridgeBot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "platform" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "botToken" TEXT,
  "config" TEXT,
  "credentialHash" TEXT,
  "defaultAgentId" TEXT,
  "chatRoomId" TEXT,
  "ownerId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BridgeBot_defaultAgentId_fkey" FOREIGN KEY ("defaultAgentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "BridgeBot_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "BridgeBot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_BridgeBot" (
  "id",
  "platform",
  "name",
  "botToken",
  "config",
  "credentialHash",
  "defaultAgentId",
  "chatRoomId",
  "createdAt",
  "updatedAt",
  "enabled"
)
SELECT
  "id",
  "platform",
  "name",
  "botToken",
  "config",
  "credentialHash",
  "defaultAgentId",
  "chatRoomId",
  "createdAt",
  "updatedAt",
  "enabled"
FROM "BridgeBot";

DROP TABLE "BridgeBot";
ALTER TABLE "new_BridgeBot" RENAME TO "BridgeBot";

CREATE UNIQUE INDEX "BridgeBot_platform_credentialHash_key" ON "BridgeBot"("platform", "credentialHash");
CREATE INDEX "BridgeBot_platform_createdAt_idx" ON "BridgeBot"("platform", "createdAt");
CREATE INDEX "BridgeBot_chatRoomId_idx" ON "BridgeBot"("chatRoomId");
CREATE INDEX "BridgeBot_ownerId_idx" ON "BridgeBot"("ownerId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
