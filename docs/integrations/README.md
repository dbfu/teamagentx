# TeamAgentX 外部平台集成总览

TeamAgentX 通过 **Bridge Service** 与外部聊天平台对接，让外部群聊用户无需安装 TeamAgentX 客户端即可使用多 Agent 能力。

## 核心映射模型

```
外部群聊（Telegram / 飞书 / 钉钉 / 企业微信 / QQ）
    ↕ Bridge Service 双向桥接
TeamAgentX ChatRoom（含多个 AI 助手）
```

**关键设计：**
- 外部群成员**无需注册** TeamAgentX 账号，身份信息嵌入消息内容
- 每个平台只需 **1 个机器人账号**，代理所有 AI 助手发言
- 机器人被拉入群后**自动创建** ChatRoom 并关联默认助手

## 支持平台

| 平台 | 文档 | 对接方式 | 注册难度 |
|------|------|---------|---------|
| Telegram | [telegram.md](./telegram.md) | Bot API + Webhook | ★☆☆☆☆ |
| 飞书 | [feishu.md](./feishu.md) | 自建应用 + 事件订阅 | ★★☆☆☆ |
| 钉钉 | [dingtalk.md](./dingtalk.md) | 企业内部应用 | ★★★☆☆ |
| 企业微信 | [wecom.md](./wecom.md) | 企业微信应用 | ★★★☆☆ |
| QQ | [qq.md](./qq.md) | QQ 开放平台 Bot | ★★☆☆☆ |

## 专项建议

- [bridge-recommendations.md](./bridge-recommendations.md)  
  基于分支 `feat/external-platform-bridge` 当前代码现状整理的专项建议，包含产品方向、架构优化、可靠性、安全、接入体验和阶段性优先级。

- [external-platform-helper-design.md](./external-platform-helper-design.md)
  外部平台接入系统助手的详细设计，覆盖平台说明模型、聊天式配置流程、绑定码共享、运行态同步和当前边界。

## 消息流程

```
外部用户发送：@机器人 @claude 帮我分析这段代码
                   ↓
          Bridge Service 解析
          发送者: Alice | 目标: claude
                   ↓
     POST /api/bridge/message（内部 HTTP 接口）
                   ↓
     TeamAgentX 路由到 Claude Agent 执行
                   ↓
     Bridge Service 收到响应，回发到外部群：
          [Claude] 好的，以下是分析结果...
```

## Agent 路由规则

| 用户输入 | 路由结果 |
|---------|---------|
| `@机器人 @claude 内容` | 触发 Claude Agent |
| `@机器人 @codex 内容` | 触发 Codex Agent |
| `@机器人 内容`（无 @agent）| 触发该群默认 Agent |

## 数据库模型

外部群聊与 TeamAgentX ChatRoom 的映射存储在 `ExternalChannel` 表：

```prisma
model ExternalChannel {
  platform      String   // telegram | feishu | dingtalk | wecom | qq
  externalId    String   // 平台侧群 ID
  chatRoomId    String   // 关联的 TeamAgentX ChatRoom
  botToken      String?  // 平台机器人 Token（加密存储）
  defaultAgentId String? // 该群默认 Agent
  @@unique([platform, externalId])
}
```

## 快速开始

1. 在各平台注册机器人，获取 Bot Token
2. 在 TeamAgentX 后台 → 外部集成 → 填写 Bot Token
3. 将机器人添加到外部群聊
4. 机器人自动创建 ChatRoom 并发送欢迎消息
5. 群成员使用 `@机器人 @助手名 内容` 开始对话
