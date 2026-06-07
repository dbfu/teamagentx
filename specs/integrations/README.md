# TeamAgentX 外部平台接入总览

## 当前模型

TeamAgentX 现在的外部平台接入统一采用下面这套模型：

- `BridgeBot` 表示一个“机器人实例”
- 一个机器人实例对应一套外部平台凭证
- 一个机器人实例最多绑定一个 TeamAgentX 群聊
- 一个 TeamAgentX 群聊可以同时绑定多个机器人实例
- 这些机器人实例可以来自不同平台，也可以来自同一平台
- 机器人只负责通信，不负责决定默认由哪个助手回复

已经废弃的旧概念：

- `ExternalChannel` 风格的“外部平台群聊映射”
- “一个外部群对应一个内部群”的强绑定叙事
- “一个群聊只能绑定一个机器人”
- “机器人默认助手决定回复逻辑”

## 核心行为

### 1. 外部平台 -> TeamAgentX

- 某个机器人实例收到外部消息
- 只要它已经绑定了 TeamAgentX 群聊，就会把消息写入这个群
- 写入后的消息会继续走群聊原本的助手触发逻辑
- 是否自动回复，取决于群自己的默认助手和 `@助手` 规则，不取决于机器人实例

### 2. TeamAgentX -> 外部平台

- 当群里有人发消息时，系统会尝试把这条消息同步到该群绑定的机器人实例
- 只有“已经建立过来源会话”的机器人，才会继续向对应外部会话发消息
- 当助手开始执行时，系统会向这些外部会话发送“输入中”状态
- 当助手产出回复时，系统会把回复同步到这些外部会话

### 3. 绑定方式

- 在频道页面创建机器人实例时直接选择群聊绑定
- 在频道页面创建后再绑定到群聊
- 在群里通过“外部平台接入”系统助手录入平台凭证并自动绑定当前群聊
- `/bind CODE` 仍然可以作为辅助能力保留，但不再是主流程

## UI 约定

### 频道页面

- 按平台查看机器人实例
- 每张卡片尽量压缩到 1 到 2 行核心信息
- 展示：机器人名称、平台、状态、当前绑定群聊、凭证是否已保存
- 允许直接切换绑定群聊
- 右侧展示“群聊 -> 已连接机器人列表”的概览

### 群设置页面

- 不再展示“单一绑定关系”
- 改为展示当前群已连接的机器人列表
- 每行展示：机器人名称、平台、状态、解绑按钮

## 数据模型

当前接入主模型：

```prisma
model BridgeBot {
  id             String   @id @default(uuid())
  platform       String
  name           String
  botToken       String?
  config         String?
  defaultAgentId String?
  chatRoomId     String?
  enabled        Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

注意：

- `chatRoomId` 现在不是唯一值
- 这意味着一个群聊下可以挂多个 `BridgeBot`
- `defaultAgentId` 仍是兼容字段，但新的桥接主逻辑不依赖它

## 平台清单

| 平台 | 文档 | 当前接入方式 |
| --- | --- | --- |
| Telegram | [telegram.md](./telegram.md) | Bot Token + Webhook / Bot API |
| 飞书 | [feishu.md](./feishu.md) | App ID / App Secret + 长连接 |
| 钉钉 | [dingtalk.md](./dingtalk.md) | 应用凭证 + Stream / Session Webhook |
| 企业微信 | [wecom.md](./wecom.md) | 企业应用凭证 + 回调 |
| QQ | [qq.md](./qq.md) | 机器人凭证 + Webhook / 开放平台 API |

## 相关文档

- [external-platform-helper-design.md](./external-platform-helper-design.md)
- [bridge-recommendations.md](./bridge-recommendations.md)
- [feishu.md](./feishu.md)
- [telegram.md](./telegram.md)
- [dingtalk.md](./dingtalk.md)
- [wecom.md](./wecom.md)
- [qq.md](./qq.md)
