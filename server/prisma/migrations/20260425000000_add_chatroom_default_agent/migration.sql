-- Add default assistant for owner messages without @mentions.
ALTER TABLE "ChatRoom" ADD COLUMN "defaultAgentId" TEXT;
CREATE INDEX "ChatRoom_defaultAgentId_idx" ON "ChatRoom"("defaultAgentId");
