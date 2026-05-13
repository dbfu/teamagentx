-- Add model capability and image generation configuration.
ALTER TABLE "LlmProvider" ADD COLUMN "modelType" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "LlmProvider" ADD COLUMN "imageProvider" TEXT;
ALTER TABLE "LlmProvider" ADD COLUMN "imageApiType" TEXT;

CREATE INDEX "LlmProvider_modelType_idx" ON "LlmProvider"("modelType");
