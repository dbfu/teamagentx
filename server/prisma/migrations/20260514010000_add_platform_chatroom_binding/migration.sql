PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_PlatformConfig" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "platform" TEXT NOT NULL,
  "botToken" TEXT,
  "config" TEXT,
  "defaultAgentId" TEXT,
  "chatRoomId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PlatformConfig_defaultAgentId_fkey" FOREIGN KEY ("defaultAgentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlatformConfig_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_PlatformConfig" ("id", "platform", "botToken", "config", "defaultAgentId", "createdAt", "updatedAt")
SELECT "id", "platform", "botToken", "config", "defaultAgentId", "createdAt", "updatedAt"
FROM "PlatformConfig";

DROP TABLE "PlatformConfig";
ALTER TABLE "new_PlatformConfig" RENAME TO "PlatformConfig";

CREATE UNIQUE INDEX "PlatformConfig_platform_key" ON "PlatformConfig"("platform");
CREATE UNIQUE INDEX "PlatformConfig_chatRoomId_key" ON "PlatformConfig"("chatRoomId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
