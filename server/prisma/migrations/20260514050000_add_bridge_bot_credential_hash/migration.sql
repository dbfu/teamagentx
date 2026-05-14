-- Add credentialHash column for duplicate credential detection
ALTER TABLE "BridgeBot" ADD COLUMN "credentialHash" TEXT;

CREATE UNIQUE INDEX "BridgeBot_platform_credentialHash_key"
  ON "BridgeBot"("platform", "credentialHash");
