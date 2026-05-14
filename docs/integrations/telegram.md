# Telegram 集成

## 适用模型

Telegram 在 TeamAgentX 中对应“机器人实例”模式：

- 一个 Telegram Bot Token = 一个 `BridgeBot`
- 一个 Telegram 机器人实例最多绑定一个 TeamAgentX 群聊
- 一个 TeamAgentX 群聊可以同时绑定多个机器人实例

## 需要准备

- Telegram Bot Token
- TeamAgentX 可访问的公网地址

如果使用 Webhook，地址形如：

```text
https://your-domain.com/api/bridge/webhook/telegram/<botId>
```

## 推荐接入步骤

1. 在 Telegram 使用 `@BotFather` 创建机器人
2. 拿到 Bot Token
3. 打开 TeamAgentX 集成页面，进入 Telegram
4. 新建机器人实例，填写名称和 Bot Token
5. 直接选择要绑定的 TeamAgentX 群聊，保存
6. 如果采用 Webhook，把 TeamAgentX 生成的 webhook 地址配置到 Telegram

## 运行行为

- Telegram 用户给该机器人发消息后，消息会进入绑定群聊
- 群聊里的用户消息会同步回这个 Telegram 会话
- 助手开始执行时，Telegram 会看到 `typing`
- 助手回复完成后，最终内容会继续回到 Telegram

## 说明

- Telegram 现在是“输入中”状态支持最完整的平台
- `/bind CODE` 可以作为辅助方式保留，但不再要求用户必须先绑定命令
