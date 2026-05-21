# Implementation Plan: 群组模板包

**Generated**: 2026-05-21
**Based on**:
- [requirements.md](/Users/liqing/qing/code/team/teamagentx/specs/group-template-package/requirements.md:1)
- [design.md](/Users/liqing/qing/code/team/teamagentx/specs/group-template-package/design.md:1)

---

- [x] 1. 定义模板包数据模型与迁移
  - 在 `server/prisma/schema.prisma` 中新增 `TemplatePackage` 与 `TemplateImportRecord` 或等价模型
  - 为 `templateId + version`、`chatRoomId` 等关键字段建立索引
  - 生成 Prisma migration，并确保不破坏现有 `ChatRoom`、`Agent`、`CronTask` 语义
  - 明确模板元数据、导入来源、未解析能力数量等字段的存储格式
  - _Requirement: M5, M6, 功能 4, 功能 5_

- [x] 2. 定义模板包文件格式与服务端类型
  - 新增模板包 `manifest.json` 的 TypeScript 类型定义
  - 定义 `group.json`、`agents.json`、`categories.json`、`cron-tasks.json`、`compatibility.json` 的结构
  - 明确 `schemaVersion`、`templateId`、`version`、`contents`、`source`、`compatibility` 等核心字段
  - 建立模板包版本兼容校验逻辑骨架
  - _Requirement: M1, M2, M6, 功能 1, 功能 2, 功能 5_

- [x] 3. 实现群组模板包导出快照构建器
  - 新增导出服务，从现有群组聚合 `ChatRoom`、助手、分类、能力配置、定时任务
  - 过滤消息历史、执行记录、长期记忆、绝对路径、密钥、Webhook 等敏感或非模板资产
  - 将现有群组运行态结构转换为模板态结构，确保模板身份与实例身份分离
  - 输出可序列化的中间快照对象，供后续打包器使用
  - _Requirement: M1, M2, M6, Story 1, 功能 1_

- [x] 4. 实现技能打包与降级策略
  - 基于现有 `skillInstallService` 增加模板技能打包器
  - 处理共享技能、复制技能、symlink 技能、外部导入技能四类来源
  - 对无法安全打包的技能输出降级声明和缺失依赖记录
  - 保留技能来源元数据，但不要求导入方联网重新安装
  - _Requirement: M2, S3, Story 1, 功能 1_

- [x] 5. 实现能力描述与映射规则
  - 设计模板内的文本、图片、语音能力描述结构
  - 将现有 `llmProviderId`、`codexModel`、`claudeModel`、`speechConfig` 转为可迁移的能力声明
  - 实现本地 provider / model 映射器，输出 `resolved`、`requires_user_selection`、`unsupported_but_importable`
  - 明确导入后“待配置”助手与能力的落库表示
  - _Requirement: M4, S2, Story 2, 功能 2, 功能 3_

- [x] 6. 实现模板包导出接口
  - 新增独立 `template-package.gateway`
  - 提供导出接口并返回下载地址或文件流
  - 记录模板元数据到 `TemplatePackage`
  - 为导出过程补充错误处理、权限校验与审计日志
  - _Requirement: M1, M2, M6, Story 1, 功能 1_

- [x] 7. 实现模板包预检接口
  - 新增模板包解析、版本校验、内容摘要生成逻辑
  - 输出群组、助手、分类、技能、定时任务的预览摘要
  - 集成能力映射器、冲突检测器、降级提示
  - 生成可复用的预检会话或令牌，供正式导入使用
  - _Requirement: S1, M4, M5, M6, Story 2, Story 3, 功能 2_

- [x] 8. 实现重复导入与冲突检测器
  - 基于 `templateId + version` 检测模板级重复导入
  - 基于来源 ID、fingerprint、名称检测助手、技能、分类、群组的资产级冲突
  - 固定支持 `cancel` / `create_copy` / `rename_copy` 三种策略
  - 实现确定性重命名规则，并将结果写入导入报告
  - _Requirement: M5, Story 4, 功能 4_

- [x] 9. 实现模板包导入落地服务
  - 基于预检结果生成导入计划
  - 在 Prisma 事务中创建新群组、副本助手、能力配置、分类映射、定时任务
  - 将无法自动映射的能力标记为待配置
  - 安装或复制技能副本，并写入 `TemplateImportRecord`
  - 对文件系统写入与数据库事务增加补偿清理逻辑
  - _Requirement: M2, M3, M4, M5, M6, Story 2, Story 4, 功能 3_

- [x] 10. 接入前端导出入口
  - 在现有群组页面或设置页增加“导出模板包”入口
  - 复用现有弹窗样式与交互模式
  - 支持输入模板标题、简介，以及是否包含技能/定时任务的导出选项
  - 补齐导出成功、失败、下载反馈
  - _Requirement: M1, M2, Story 1_

- [x] 11. 接入前端导入向导
  - 增加“从模板包导入”入口
  - 实现 3 步导入向导：选择文件、预览与处理兼容性、确认导入
  - 展示未解析能力、降级技能、重复导入提示和冲突处理动作
  - 导入成功后跳转到新群组并显示导入报告摘要
  - _Requirement: M3, M4, M5, S1, Story 2, Story 3, Story 4_

- [x] 12. 增加模板市场兼容字段但不实现市场运营能力
  - 在模板元数据中预留 `sourceType`、`sourceLabel`、`author`、`channel` 等字段
  - 确保本地导出包与未来市场下载包走同一套解析与预检逻辑
  - 不实现发布、审核、评分、付费、榜单等市场运营接口
  - _Requirement: M6, W1, Story 5, 功能 5_

- [x] 13. 编写单元测试
  - 覆盖 manifest 解析、版本校验、能力映射、冲突检测、确定性重命名、技能降级逻辑
  - 对敏感字段过滤进行测试，确保不导出密钥和绝对路径
  - 补齐模板级重复导入识别测试
  - _Requirement: M1, M4, M5, M6, NFR Maintainability/Security_

- [x] 14. 编写集成测试
  - 验证从真实群组导出模板包
  - 验证预检重复导入
  - 验证导入含图片能力、语音配置、技能缺失场景
  - 验证导入失败事务回滚和临时文件清理
  - _Requirement: Story 1, Story 2, Story 3, Story 4_

- [x] 15. 补充文档与审计
  - 记录模板包格式、版本兼容规则、降级规则、冲突处理规则
  - 为导出、预检、导入增加审计日志字段
  - 明确后续模板市场如何复用本期模板元数据
  - _Requirement: M6, NFR Security, NFR Maintainability_
