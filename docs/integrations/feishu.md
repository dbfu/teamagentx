# 飞书集成

难度：★★☆☆☆ | 对接方式：自建应用 + 事件订阅 | 方向：双向

飞书与 TeamAgentX 的 UI 风格最接近，支持富卡片消息，集成效果最佳。

## 创建飞书自建应用

1. 打开[飞书开放平台](https://open.feishu.cn/app)
2. 创建企业自建应用，填写名称和描述
3. 在**权限管理**中开启以下权限：
   - `im:message:receive_v1`（接收消息）
   - `im:message`（发送消息）
   - `im:chat:readonly`（读取群信息）
4. 在**事件订阅**中配置请求地址：
   ```
   https://your-domain.com/api/bridge/webhook/feishu
   ```
   并订阅事件：`im.message.receive_v1`（接收消息事件）
5. 获取 **App ID** 和 **App Secret**，以及 **Verification Token**

## 配置到 TeamAgentX

1. TeamAgentX 后台 → 外部集成 → 飞书
2. 填写 App ID、App Secret、Verification Token → 保存

## 使用方式

**将机器人添加到飞书群：**
- 群设置 → 机器人 → 添加机器人 → 选择已创建的应用
- 机器人自动在 TeamAgentX 创建对应 ChatRoom

**群成员发送消息：**
```
@TeamAgentX @Claude 帮我整理这份会议记录
@TeamAgentX @Codex 写一个数据处理脚本
@TeamAgentX 明天的会议议程是什么     ← 触发默认助手
```

**机器人回复（富文本卡片格式）：**
```
┌─────────────────────────────┐
│ 💬 Claude                   │
│─────────────────────────────│
│ 好的，以下是整理后的会议记录...  │
└─────────────────────────────┘
```

## Webhook 接收的消息格式

飞书发送的消息事件：

```json
{
  "schema": "2.0",
  "header": {
    "event_type": "im.message.receive_v1",
    "token": "verification_token"
  },
  "event": {
    "sender": { "sender_id": { "open_id": "ou_xxx", "user_id": "xxx" } },
    "message": {
      "chat_id": "oc_xxx",
      "chat_type": "group",
      "content": "{\"text\":\"@_user_1 @Claude 帮我分析这段代码\"}",
      "mentions": [
        { "key": "@_user_1", "name": "TeamAgentX" },
        { "key": "@_user_2", "name": "Claude" }
      ]
    }
  }
}
```

## 注意事项

- 飞书事件订阅需要通过**验证请求**（Verification Token 校验）
- 飞书 open_id 是用户在应用维度的唯一 ID，可用于回溯发送者信息
- 支持发送卡片消息（Card）实现更好的视觉效果
- 企业内部应用需要企业管理员审批后才能在群中使用
