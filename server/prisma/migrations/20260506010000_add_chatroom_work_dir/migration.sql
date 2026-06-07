-- Add a shared working directory at chat room scope.

ALTER TABLE "ChatRoom" ADD COLUMN "workDir" TEXT;
