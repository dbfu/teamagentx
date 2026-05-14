/*
  Warnings:

  - You are about to alter the column `config` on the `AgentCapability` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentCapability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "capabilityType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "llmProviderId" TEXT,
    "config" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentCapability_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentCapability_llmProviderId_fkey" FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentCapability" ("agentId", "capabilityType", "config", "createdAt", "enabled", "id", "llmProviderId", "updatedAt") SELECT "agentId", "capabilityType", "config", "createdAt", "enabled", "id", "llmProviderId", "updatedAt" FROM "AgentCapability";
DROP TABLE "AgentCapability";
ALTER TABLE "new_AgentCapability" RENAME TO "AgentCapability";
CREATE INDEX "AgentCapability_agentId_idx" ON "AgentCapability"("agentId");
CREATE INDEX "AgentCapability_llmProviderId_idx" ON "AgentCapability"("llmProviderId");
CREATE UNIQUE INDEX "AgentCapability_agentId_capabilityType_key" ON "AgentCapability"("agentId", "capabilityType");
CREATE TABLE "new_AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSetting" ("key", "updatedAt", "value") SELECT "key", "updatedAt", "value" FROM "AppSetting";
DROP TABLE "AppSetting";
ALTER TABLE "new_AppSetting" RENAME TO "AppSetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
