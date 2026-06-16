-- 连接器（MCP server）：全局注册，助手按需启用
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "transport" TEXT NOT NULL DEFAULT 'stdio',
    "command" TEXT,
    "args" TEXT DEFAULT '[]',
    "env" TEXT DEFAULT '{}',
    "url" TEXT,
    "headers" TEXT DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- 助手与连接器的多对多绑定
CREATE TABLE "AgentConnector" (
    "agentId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("agentId", "connectorId"),
    CONSTRAINT "AgentConnector_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentConnector_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Connector_name_key" ON "Connector"("name");
CREATE INDEX "Connector_enabled_idx" ON "Connector"("enabled");
CREATE INDEX "AgentConnector_agentId_idx" ON "AgentConnector"("agentId");
CREATE INDEX "AgentConnector_connectorId_idx" ON "AgentConnector"("connectorId");
