-- CreateTable
CREATE TABLE "Agent" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("categoryId") REFERENCES "AgentCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'image',
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BackgroundTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatRoomId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "workDir" TEXT NOT NULL,
    "pid" INTEGER,
    "state" TEXT NOT NULL DEFAULT 'running',
    "exitCode" INTEGER,
    "stdoutPath" TEXT NOT NULL,
    "stderrPath" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "lastOutputAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChatRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT,
    "isQuickChatRoom" BOOLEAN NOT NULL DEFAULT false,
    "quickChatAgentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "avatar" TEXT,
    "avatarColor" TEXT,
    "rules" TEXT,
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatRoomAgent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatRoomId" TEXT NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "injectGroupHistory" BOOLEAN NOT NULL DEFAULT true,
    "customWorkDir" TEXT,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInjectedMessageId" TEXT,
    FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CronTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatRoomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scheduleType" TEXT NOT NULL DEFAULT 'cron',
    "cronExpression" TEXT,
    "intervalMinutes" INTEGER,
    "scheduledAt" DATETIME,
    "payload" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT,
    "agentIds" TEXT DEFAULT '[]',
    FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CronTaskExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cronTaskId" TEXT NOT NULL,
    "triggeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "executionRecordId" TEXT,
    "errorMessage" TEXT,
    "duration" INTEGER,
    "payloadSnapshot" TEXT NOT NULL,
    FOREIGN KEY ("cronTaskId") REFERENCES "CronTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatRoomId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "triggerMessage" TEXT NOT NULL,
    "triggerUser" TEXT,
    "events" TEXT NOT NULL DEFAULT '[]',
    "context" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "errorMessage" TEXT,
    "duration" INTEGER,
    "llmProviderId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "cacheCreationTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LlmProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'anthropic',
    "apiProtocol" TEXT NOT NULL DEFAULT 'anthropic',
    "apiUrl" TEXT,
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'MESSAGE',
    "content" TEXT NOT NULL,
    "time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "agentId" TEXT,
    "chatRoomId" TEXT NOT NULL,
    "replyMessageId" TEXT,
    "isHuman" BOOLEAN NOT NULL DEFAULT true,
    "executionRecordId" TEXT,
    "executionDuration" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "totalTokens" INTEGER,
    FOREIGN KEY ("executionRecordId") REFERENCES "ExecutionRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("replyMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuickChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "chatRoomId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "workDir" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatRoomId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "messageContent" TEXT NOT NULL,
    "history" TEXT,
    "sessionDir" TEXT,
    "attachments" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Todo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatRoomId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "triggerAgentId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "contentSummary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("triggerAgentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "socketId" TEXT,
    "clientId" TEXT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "avatar" TEXT,
    "avatarColor" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "checkpoints" (
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "checkpoint_id" TEXT NOT NULL,
    "parent_checkpoint_id" TEXT,
    "type" TEXT,
    "checkpoint" BLOB,
    "metadata" BLOB,

    PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id")
);

-- CreateTable
CREATE TABLE "writes" (
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "checkpoint_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT,
    "value" BLOB,

    PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx")
);

-- CreateIndex
CREATE INDEX "Agent_agentLevel_idx" ON "Agent"("agentLevel" ASC);

-- CreateIndex
CREATE INDEX "Agent_llmProviderId_idx" ON "Agent"("llmProviderId" ASC);

-- CreateIndex
CREATE INDEX "Agent_categoryId_idx" ON "Agent"("categoryId" ASC);

-- CreateIndex
CREATE INDEX "Agent_name_idx" ON "Agent"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name" ASC);

-- CreateIndex
CREATE INDEX "AgentCategory_sortOrder_idx" ON "AgentCategory"("sortOrder" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AgentCategory_name_key" ON "AgentCategory"("name" ASC);

-- CreateIndex
CREATE INDEX "Attachment_createdAt_idx" ON "Attachment"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId" ASC);

-- CreateIndex
CREATE INDEX "BackgroundTask_startedAt_idx" ON "BackgroundTask"("startedAt" ASC);

-- CreateIndex
CREATE INDEX "BackgroundTask_state_idx" ON "BackgroundTask"("state" ASC);

-- CreateIndex
CREATE INDEX "BackgroundTask_chatRoomId_agentId_idx" ON "BackgroundTask"("chatRoomId" ASC, "agentId" ASC);

-- CreateIndex
CREATE INDEX "ChatRoom_quickChatAgentId_idx" ON "ChatRoom"("quickChatAgentId" ASC);

-- CreateIndex
CREATE INDEX "ChatRoom_ownerId_idx" ON "ChatRoom"("ownerId" ASC);

-- CreateIndex
CREATE INDEX "ChatRoom_name_idx" ON "ChatRoom"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoomAgent_chatRoomId_userId_key" ON "ChatRoomAgent"("chatRoomId" ASC, "userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoomAgent_chatRoomId_agentId_key" ON "ChatRoomAgent"("chatRoomId" ASC, "agentId" ASC);

-- CreateIndex
CREATE INDEX "ChatRoomAgent_chatRoomId_idx" ON "ChatRoomAgent"("chatRoomId" ASC);

-- CreateIndex
CREATE INDEX "CronTask_chatRoomId_idx" ON "CronTask"("chatRoomId" ASC);

-- CreateIndex
CREATE INDEX "CronTask_enabled_nextRunAt_idx" ON "CronTask"("enabled" ASC, "nextRunAt" ASC);

-- CreateIndex
CREATE INDEX "CronTaskExecution_cronTaskId_triggeredAt_idx" ON "CronTaskExecution"("cronTaskId" ASC, "triggeredAt" ASC);

-- CreateIndex
CREATE INDEX "ExecutionRecord_llmProviderId_idx" ON "ExecutionRecord"("llmProviderId" ASC);

-- CreateIndex
CREATE INDEX "ExecutionRecord_createdAt_idx" ON "ExecutionRecord"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "ExecutionRecord_agentId_idx" ON "ExecutionRecord"("agentId" ASC);

-- CreateIndex
CREATE INDEX "ExecutionRecord_chatRoomId_agentId_idx" ON "ExecutionRecord"("chatRoomId" ASC, "agentId" ASC);

-- CreateIndex
CREATE INDEX "LlmProvider_name_idx" ON "LlmProvider"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LlmProvider_name_key" ON "LlmProvider"("name" ASC);

-- CreateIndex
CREATE INDEX "Message_executionRecordId_idx" ON "Message"("executionRecordId" ASC);

-- CreateIndex
CREATE INDEX "Message_userId_idx" ON "Message"("userId" ASC);

-- CreateIndex
CREATE INDEX "Message_agentId_idx" ON "Message"("agentId" ASC);

-- CreateIndex
CREATE INDEX "Message_chatRoomId_idx" ON "Message"("chatRoomId" ASC);

-- CreateIndex
CREATE INDEX "Message_time_idx" ON "Message"("time" ASC);

-- CreateIndex
CREATE INDEX "QuickChatSession_createdAt_idx" ON "QuickChatSession"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "QuickChatSession_agentId_idx" ON "QuickChatSession"("agentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "QuickChatSession_sessionId_key" ON "QuickChatSession"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "TaskQueue_status_idx" ON "TaskQueue"("status" ASC);

-- CreateIndex
CREATE INDEX "TaskQueue_chatRoomId_agentId_idx" ON "TaskQueue"("chatRoomId" ASC, "agentId" ASC);

-- CreateIndex
CREATE INDEX "TaskQueue_createdAt_idx" ON "TaskQueue"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Todo_createdAt_idx" ON "Todo"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Todo_chatRoomId_idx" ON "Todo"("chatRoomId" ASC);

-- CreateIndex
CREATE INDEX "Todo_ownerUserId_status_idx" ON "Todo"("ownerUserId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Todo_messageId_key" ON "Todo"("messageId" ASC);

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_clientId_key" ON "User"("clientId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_socketId_key" ON "User"("socketId" ASC);

