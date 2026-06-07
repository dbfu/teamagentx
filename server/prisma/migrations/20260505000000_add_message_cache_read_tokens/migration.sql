-- Store cache-read token counts on generated messages so the UI can display non-cached token usage.

ALTER TABLE "Message" ADD COLUMN "cacheReadTokens" INTEGER;
