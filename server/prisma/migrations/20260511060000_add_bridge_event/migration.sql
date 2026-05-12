CREATE TABLE "BridgeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "messageId" TEXT,
    "agentName" TEXT,
    "errorMsg" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BridgeEvent_platform_createdAt_idx" ON "BridgeEvent"("platform", "createdAt");
CREATE INDEX "BridgeEvent_createdAt_idx" ON "BridgeEvent"("createdAt");
