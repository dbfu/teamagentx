-- Add local Claude session binding fields for quick chat rooms.
ALTER TABLE "QuickChatSession" ADD COLUMN "claudeLocalSessionId" TEXT;
ALTER TABLE "QuickChatSession" ADD COLUMN "claudeLocalSessionTitle" TEXT;
ALTER TABLE "QuickChatSession" ADD COLUMN "claudeLocalSessionModified" DATETIME;

CREATE INDEX "QuickChatSession_claudeLocalSessionId_idx" ON "QuickChatSession"("claudeLocalSessionId");
