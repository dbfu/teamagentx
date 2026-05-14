CREATE TABLE "BridgeBot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "botToken" TEXT,
    "config" TEXT,
    "defaultAgentId" TEXT,
    "chatRoomId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BridgeBot_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BridgeBot_defaultAgentId_fkey" FOREIGN KEY ("defaultAgentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BridgeBot_chatRoomId_key" ON "BridgeBot"("chatRoomId");
CREATE INDEX "BridgeBot_platform_createdAt_idx" ON "BridgeBot"("platform", "createdAt");
CREATE INDEX "BridgeBot_chatRoomId_idx" ON "BridgeBot"("chatRoomId");

INSERT INTO "BridgeBot" (
    "id",
    "platform",
    "name",
    "botToken",
    "config",
    "defaultAgentId",
    "chatRoomId",
    "enabled",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "platform",
    CASE "platform"
        WHEN 'telegram' THEN 'Telegram 机器人'
        WHEN 'feishu' THEN '飞书机器人'
        WHEN 'dingtalk' THEN '钉钉机器人'
        WHEN 'wecom' THEN '企业微信机器人'
        WHEN 'qq' THEN 'QQ 机器人'
        ELSE "platform" || ' 机器人'
    END,
    "botToken",
    "config",
    "defaultAgentId",
    "chatRoomId",
    "enabled",
    "createdAt",
    "updatedAt"
FROM "PlatformConfig"
WHERE "platform" <> 'system'
  AND ("botToken" IS NOT NULL OR "config" IS NOT NULL OR "chatRoomId" IS NOT NULL);
