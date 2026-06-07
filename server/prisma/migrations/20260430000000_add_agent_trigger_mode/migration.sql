-- Add agentTriggerMode field to ChatRoom
-- This field controls whether agent messages with @ mentions trigger other agents
-- Default: 'auto' (mentions trigger agents), 'manual' (mentions do not trigger)

-- AlterTable
ALTER TABLE "ChatRoom" ADD COLUMN "agentTriggerMode" TEXT DEFAULT 'auto';