-- Add assistant-level voice configuration and audio attachment metadata.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "voiceConfig" TEXT;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "durationMs" INTEGER;
ALTER TABLE "Attachment" ADD COLUMN "transcript" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "waveform" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_type_idx" ON "Attachment"("type");
