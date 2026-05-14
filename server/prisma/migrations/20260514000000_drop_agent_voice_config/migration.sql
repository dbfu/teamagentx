-- 删除已迁移完成的旧 voiceConfig 列
ALTER TABLE "Agent" DROP COLUMN "voiceConfig";
