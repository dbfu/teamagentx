# Implementation Plan: channel-markdown-support

**Generated**: 2026-05-19
**Status**: Draft
**Input**:
- [requirements.md](/Users/liqing/qing/code/team/teamagentx/specs/channel-markdown-support/requirements.md)
- [design.md](/Users/liqing/qing/code/team/teamagentx/specs/channel-markdown-support/design.md)

---

## Task List

- [ ] 1. 建立统一消息格式转换层
  - 在 `server/src/modules/bridge/` 下新增统一 formatter 模块，负责“统一 Markdown 输入 -> 平台格式输出”
  - 定义平台格式枚举与转换结果结构，例如 `telegram_markdown_v2`、`feishu_lark_md`、`wecom_markdown`、`dingtalk_markdown`、`plain_text`
  - 定义最小可移植 Markdown 子集与统一降级规则，覆盖表格、任务列表、HTML、图片语法等不兼容输入
  - 保持接口最小化，避免提前抽象成复杂 AST 或多层插件体系
  - _Requirement: M1, M4, M5; 功能 1, 功能 2, 功能 3_

- [x] 2. 实现 Telegram `MarkdownV2` 转换器
  - 用新的 `markdownToTelegramMarkdownV2` 替代当前 HTML 转换路径
  - 实现 Telegram 保留字符转义、代码块/行内代码/引用/链接/列表的合法映射
  - 保证不支持语法先降级再转义，避免生成非法 `MarkdownV2`
  - 设计一轮格式失败后的纯文本回退策略，仅用于格式类错误
  - _Requirement: M2, M4; Story 1; 功能 2, 功能 3_

- [ ] 3. 实现飞书 `lark_md` 转换器
  - 将飞书目标格式统一为 `lark_md`
  - 明确飞书头部、正文、群聊转发前缀在 `lark_md` 中的表达方式
  - 将 CommonMark/GFM 特有结构降级为飞书可读文本
  - 保持 sender 与格式规则分离，sender 只消费格式化结果
  - _Requirement: M3, M4; Story 2; 功能 2, 功能 3_

- [ ] 4. 收敛企业微信、钉钉、QQ 的目标格式与降级规则
  - 企业微信继续走 markdown，但把规则移动到统一 formatter 层
  - 钉钉根据投递路径区分 `markdown` 与 `text`，避免 sender 内散落格式判断
  - QQ 明确按纯文本策略发送，保留换行和链接字面值
  - 保证所有已接入平台都有唯一、明确、可测试的目标格式
  - _Requirement: M1, M4; Story 3; 功能 1, 功能 2, 功能 3_

- [ ] 5. 改造 `platform-senders.ts` 以接入 formatter 层
  - 保持 `bridgeService.registerSender()`、`sendAgentResponse()`、`syncRoomMessage()` 的调用契约不变
  - 各平台 sender 改为先调用 formatter，再根据返回格式构造平台请求
  - 清理 Telegram HTML 路径与 sender 内重复的 Markdown 处理逻辑
  - 保留现有 typing、clearTyping、事件记录逻辑不变
  - _Requirement: M1, M2, M3, M4; 功能 1, 功能 2, 功能 3_

- [ ] 6. 补齐单元测试与 sender 测试
  - 为统一 formatter 增加独立测试文件，覆盖最小子集、降级规则和平台差异
  - 更新 `server/src/modules/bridge/platform-senders.test.ts`
  - 增加 Telegram `MarkdownV2`、飞书 `lark_md`、企业微信 markdown、钉钉 markdown/text、QQ 纯文本断言
  - 验证平台格式失败时的纯文本回退只在可恢复错误下触发
  - _Requirement: S1; Story 1, Story 2, Story 3_

- [ ] 7. 验证 bridge 出站链路的兼容性
  - 运行 bridge 相关测试，确认 `sendAgentResponse`、`syncRoomMessage` 的现有行为未被破坏
  - 检查多平台并发发送时格式结果不会互相污染
  - 检查 outbound 成功/失败事件仍被正确记录
  - 如有必要补充一到两个 bridge service 级别测试用例
  - _Requirement: M4; 功能 1, 功能 3_

- [ ] 8. 补充实现说明与支持矩阵文档
  - 在 bridge 模块内或 spec 文档中保留最终支持矩阵，方便后续接入新频道
  - 记录每个平台的目标格式、支持子集、默认降级规则
  - 如代码中存在容易误解的转换顺序，添加简短注释说明
  - _Requirement: S2; M5_

---

## Recommended Execution Order

- [ ] Phase A: 任务 1
- [ ] Phase B: 任务 2、任务 3、任务 4
- [ ] Phase C: 任务 5
- [ ] Phase D: 任务 6、任务 7
- [ ] Phase E: 任务 8

---

## Notes

- 本期避免改动 `bridgeService` 的上游调用签名，尽量把影响面限制在 `server/src/modules/bridge/`
- 本期不引入数据库 schema 变更
- 若飞书 `lark_md` 的最终承载结构与现有 card 接口存在差异，优先保证 formatter 层和 sender 层解耦，再决定具体消息体结构
