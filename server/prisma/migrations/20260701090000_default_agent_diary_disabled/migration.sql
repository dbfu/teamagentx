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
    "proxyConfig" TEXT,
    "codexModel" TEXT,
    "codexFastMode" BOOLEAN NOT NULL DEFAULT false,
    "claudeModel" TEXT,
    "thinkingMode" TEXT NOT NULL DEFAULT 'high',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" TEXT,
    "llmProviderId" TEXT,
    "fallbackLlmProviderIds" TEXT,
    "speechConfig" TEXT,
    "diaryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Agent_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AgentCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Agent_llmProviderId_fkey" FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Agent" (
    "id",
    "name",
    "avatar",
    "avatarColor",
    "description",
    "prompt",
    "type",
    "agentLevel",
    "acpTool",
    "workDir",
    "proxyConfig",
    "codexModel",
    "codexFastMode",
    "claudeModel",
    "thinkingMode",
    "isActive",
    "categoryId",
    "llmProviderId",
    "fallbackLlmProviderIds",
    "speechConfig",
    "diaryEnabled",
    "sortOrder",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "name",
    "avatar",
    "avatarColor",
    "description",
    "prompt",
    "type",
    "agentLevel",
    "acpTool",
    "workDir",
    "proxyConfig",
    "codexModel",
    "codexFastMode",
    "claudeModel",
    "thinkingMode",
    "isActive",
    "categoryId",
    "llmProviderId",
    "fallbackLlmProviderIds",
    "speechConfig",
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "AppSetting"
        WHERE "key" = 'diaryEnabled' AND "value" = 'true'
      )
      THEN true
      ELSE false
    END,
    "sortOrder",
    "createdAt",
    "updatedAt"
FROM "Agent";

DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";

CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name");
CREATE INDEX "Agent_name_idx" ON "Agent"("name");
CREATE INDEX "Agent_categoryId_idx" ON "Agent"("categoryId");
CREATE INDEX "Agent_llmProviderId_idx" ON "Agent"("llmProviderId");
CREATE INDEX "Agent_agentLevel_idx" ON "Agent"("agentLevel");
CREATE INDEX "Agent_categoryId_sortOrder_idx" ON "Agent"("categoryId", "sortOrder");
CREATE INDEX "Agent_sortOrder_idx" ON "Agent"("sortOrder");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
