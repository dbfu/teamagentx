/*
  Warnings:

  - You are about to drop the `checkpoints` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `writes` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "checkpoints";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "writes";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "ExternalChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "chatRoomId" TEXT NOT NULL,
    "botToken" TEXT,
    "webhookSecret" TEXT,
    "defaultAgentId" TEXT,
    "config" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExternalChannel_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExternalChannel_defaultAgentId_fkey" FOREIGN KEY ("defaultAgentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "avatarColor" TEXT,
    "description" TEXT,
    "prompt" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'builtin',
    "agentLevel" TEXT NOT NULL DEFAULT 'normal',
    "acpTool" TEXT,
    "workDir" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" TEXT,
    "llmProviderId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Agent_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AgentCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Agent_llmProviderId_fkey" FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Agent" ("acpTool", "agentLevel", "avatar", "avatarColor", "categoryId", "createdAt", "description", "id", "isActive", "llmProviderId", "name", "prompt", "sortOrder", "type", "updatedAt", "workDir") SELECT "acpTool", "agentLevel", "avatar", "avatarColor", "categoryId", "createdAt", "description", "id", "isActive", "llmProviderId", "name", "prompt", coalesce("sortOrder", 0) AS "sortOrder", "type", "updatedAt", "workDir" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name");
CREATE INDEX "Agent_name_idx" ON "Agent"("name");
CREATE INDEX "Agent_categoryId_idx" ON "Agent"("categoryId");
CREATE INDEX "Agent_llmProviderId_idx" ON "Agent"("llmProviderId");
CREATE INDEX "Agent_agentLevel_idx" ON "Agent"("agentLevel");
CREATE INDEX "Agent_categoryId_sortOrder_idx" ON "Agent"("categoryId", "sortOrder");
CREATE TABLE "new_ChatRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" TEXT,
    "workDir" TEXT,
    "ownerId" TEXT,
    "isQuickChatRoom" BOOLEAN NOT NULL DEFAULT false,
    "quickChatAgentId" TEXT,
    "defaultAgentId" TEXT,
    "agentTriggerMode" TEXT NOT NULL DEFAULT 'auto',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "avatar" TEXT,
    "avatarColor" TEXT,
    CONSTRAINT "ChatRoom_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ChatRoom" ("agentTriggerMode", "avatar", "avatarColor", "createdAt", "defaultAgentId", "description", "id", "isPinned", "isQuickChatRoom", "name", "ownerId", "pinnedAt", "quickChatAgentId", "rules", "updatedAt", "workDir") SELECT coalesce("agentTriggerMode", 'auto') AS "agentTriggerMode", "avatar", "avatarColor", "createdAt", "defaultAgentId", "description", "id", "isPinned", "isQuickChatRoom", "name", "ownerId", "pinnedAt", "quickChatAgentId", "rules", "updatedAt", "workDir" FROM "ChatRoom";
DROP TABLE "ChatRoom";
ALTER TABLE "new_ChatRoom" RENAME TO "ChatRoom";
CREATE INDEX "ChatRoom_name_idx" ON "ChatRoom"("name");
CREATE INDEX "ChatRoom_ownerId_idx" ON "ChatRoom"("ownerId");
CREATE INDEX "ChatRoom_quickChatAgentId_idx" ON "ChatRoom"("quickChatAgentId");
CREATE INDEX "ChatRoom_defaultAgentId_idx" ON "ChatRoom"("defaultAgentId");
CREATE INDEX "ChatRoom_isPinned_pinnedAt_idx" ON "ChatRoom"("isPinned", "pinnedAt");
CREATE TABLE "new_LlmProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'custom',
    "apiProtocol" TEXT NOT NULL DEFAULT 'anthropic',
    "apiUrl" TEXT,
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "supportsThinking" BOOLEAN,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_LlmProvider" ("apiKey", "apiProtocol", "apiUrl", "createdAt", "id", "isActive", "isDefault", "model", "name", "supportsThinking", "type", "updatedAt") SELECT "apiKey", "apiProtocol", "apiUrl", "createdAt", "id", "isActive", "isDefault", "model", "name", "supportsThinking", "type", "updatedAt" FROM "LlmProvider";
DROP TABLE "LlmProvider";
ALTER TABLE "new_LlmProvider" RENAME TO "LlmProvider";
CREATE UNIQUE INDEX "LlmProvider_name_key" ON "LlmProvider"("name");
CREATE INDEX "LlmProvider_name_idx" ON "LlmProvider"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ExternalChannel_chatRoomId_idx" ON "ExternalChannel"("chatRoomId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalChannel_platform_externalId_key" ON "ExternalChannel"("platform", "externalId");
