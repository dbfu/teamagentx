# Telegram 集成

难度：★☆☆☆☆ | 对接方式：Bot API + Webhook | 方向：双向

## 注册机器人

1. 在 Telegram 搜索 `@BotFather`，发送 `/newbot`
2. 填写机器人名称（显示名）和用户名（以 `_bot` 结尾）
3. 获得 **Bot Token**（格式：`123456:ABC-DEF...`），妥善保存

## 配置到 TeamAgentX

1. 打开 TeamAgentX 后台 → 外部集成 → Telegram
2. 填写 Bot Token → 保存
3. 系统自动调用 Telegram setWebhook，设置接收地址为：
   ```
   https://your-domain.com/api/bridge/webhook/telegram
   ```

## 使用方式

**将机器人拉入 Telegram 群组：**
- 机器人自动在 TeamAgentX 创建对应 ChatRoom
- 机器人发送欢迎消息："✅ TeamAgentX 已就绪，使用 @机器人 @助手名 开始对话"

**群成员发送消息：**
```
@TeamAgentX_bot @claude 帮我写一个排序算法
@TeamAgentX_bot @codex 把这段 Python 转成 TypeScript
@TeamAgentX_bot 今天天气怎么样     ← 触发默认助手
```

**机器人回复格式：**
```
[Claude] 好的，以下是快速排序算法的实现...
[Codex] 以下是转换后的 TypeScript 代码...
```

## Webhook 接收的消息格式

Telegram 发送给 TeamAgentX 的 Update 结构：

```json
{
  "update_id": 123456789,
  "message": {
    "message_id": 42,
    "from": { "id": 987, "username": "alice", "first_name": "Alice" },
    "chat": { "id": -100123456, "title": "我的工作群", "type": "supergroup" },
    "text": "@TeamAgentX_bot @claude 帮我分析这段代码",
    "entities": [
      { "type": "mention", "offset": 0, "length": 16 },
      { "type": "mention", "offset": 17, "length": 7 }
    ]
  }
}
```

## 注意事项

- Telegram 群组需将机器人设为**管理员**或允许机器人读取消息（群设置 → 隐私模式关闭）
- Bot Token 请勿泄露，系统加密存储
- 支持发送图片、文件等附件，Bridge Service 会转换为 TeamAgentX 附件格式
- Telegram 消息长度上限 4096 字符，超长响应会自动分段发送
