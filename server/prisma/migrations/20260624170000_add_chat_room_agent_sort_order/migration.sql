-- Persist the display order of normal assistants within a chat room.
ALTER TABLE "ChatRoomAgent" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ChatRoomAgent_chatRoomId_sortOrder_idx" ON "ChatRoomAgent"("chatRoomId", "sortOrder");
