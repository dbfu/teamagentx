-- CreateTable
CREATE TABLE "ChatRoomCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatRoomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT,
    CONSTRAINT "ChatRoomCommand_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ChatRoomCommand_chatRoomId_idx" ON "ChatRoomCommand"("chatRoomId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoomCommand_chatRoomId_name_key" ON "ChatRoomCommand"("chatRoomId", "name");
