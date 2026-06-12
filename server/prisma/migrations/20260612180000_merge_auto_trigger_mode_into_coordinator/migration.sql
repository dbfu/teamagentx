-- 调度模式合并：自由协作（auto）与协调模式（coordinator）合并为「智能协作」，存储值统一为 coordinator。
-- 仅数据迁移，无 schema 变更。
UPDATE "ChatRoom" SET "agentTriggerMode" = 'coordinator' WHERE "agentTriggerMode" = 'auto';
