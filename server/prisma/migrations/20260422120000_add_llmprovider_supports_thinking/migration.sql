-- Add nullable thinking capability flag for existing LLM providers.
ALTER TABLE "LlmProvider" ADD COLUMN "supportsThinking" BOOLEAN;
