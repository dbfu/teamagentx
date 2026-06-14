-- 群调度规则（工作流，YAML），注入到群调度助手用于多助手协作调度
ALTER TABLE "ChatRoom" ADD COLUMN "dispatchRules" TEXT;
