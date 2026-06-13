-- Add local Codex session binding fields for quick chat rooms.
ALTER TABLE "QuickChatSession" ADD COLUMN "codexLocalSessionId" TEXT;
ALTER TABLE "QuickChatSession" ADD COLUMN "codexLocalSessionTitle" TEXT;
ALTER TABLE "QuickChatSession" ADD COLUMN "codexLocalSessionModified" DATETIME;

CREATE INDEX "QuickChatSession_codexLocalSessionId_idx" ON "QuickChatSession"("codexLocalSessionId");
