ALTER TABLE "BridgeEvent" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "BridgeEvent_dedupeKey_key" ON "BridgeEvent"("dedupeKey");
