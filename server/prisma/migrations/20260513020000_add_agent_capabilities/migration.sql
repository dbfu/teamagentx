CREATE TABLE "AgentCapability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "capabilityType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "llmProviderId" TEXT,
    "config" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentCapability_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentCapability_llmProviderId_fkey" FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentCapability_agentId_capabilityType_key" ON "AgentCapability"("agentId", "capabilityType");
CREATE INDEX "AgentCapability_agentId_idx" ON "AgentCapability"("agentId");
CREATE INDEX "AgentCapability_llmProviderId_idx" ON "AgentCapability"("llmProviderId");
