-- AddColumn
ALTER TABLE "BridgeBot" ADD COLUMN "ownerId" TEXT;
-- CreateIndex
CREATE INDEX "BridgeBot_ownerId_idx" ON "BridgeBot"("ownerId");
