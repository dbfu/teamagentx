-- Add credentialHash column for duplicate credential detection
ALTER TABLE "BridgeBot" ADD COLUMN "credentialHash" TEXT;

-- Partial unique index: only enforce uniqueness when credentialHash is non-NULL
-- (existing rows with NULL are unaffected)
CREATE UNIQUE INDEX "BridgeBot_platform_credentialHash_key"
  ON "BridgeBot"("platform", "credentialHash")
  WHERE "credentialHash" IS NOT NULL;
