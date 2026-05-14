ALTER TABLE "PlatformConfig" ADD COLUMN "chatRoomId" TEXT;
ALTER TABLE "PlatformConfig" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "PlatformConfig_chatRoomId_key" ON "PlatformConfig"("chatRoomId");
