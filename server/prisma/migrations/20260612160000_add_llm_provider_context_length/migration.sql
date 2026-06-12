-- AlterTable: 新增 LLM 供应商上下文长度配置（token），默认 1M
ALTER TABLE "LlmProvider" ADD COLUMN "contextLength" INTEGER NOT NULL DEFAULT 1000000;
