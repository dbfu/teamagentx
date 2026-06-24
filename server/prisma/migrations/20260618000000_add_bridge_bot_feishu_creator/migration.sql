ALTER TABLE "BridgeBot" ADD COLUMN "feishuCreatorOpenId" TEXT;

CREATE INDEX "BridgeBot_feishuCreatorOpenId_idx" ON "BridgeBot"("feishuCreatorOpenId");
