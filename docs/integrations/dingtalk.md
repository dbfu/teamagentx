# 钉钉集成

难度：★★★☆☆ | 对接方式：企业内部应用 | 方向：双向

## 创建企业内部应用

1. 打开[钉钉开放平台](https://open.dingtalk.com)，进入开发者后台
2. 创建**企业内部应用**（H5 微应用或机器人）
3. 在**消息推送**中配置机器人，开启消息接收模式
4. 配置消息接收地址（Request URL）：
   ```
   https://your-domain.com/api/bridge/webhook/dingtalk
   ```
5. 在**权限管理**中开启：
   - `qyapi_chat_manage`（管理群聊）
   - `Message.read`（读取消息）
   - `Message.send`（发送消息）
6. 获取 **AppKey**、**AppSecret**

## 配置到 TeamAgentX

1. TeamAgentX 后台 → 外部集成 → 钉钉
2. 填写 AppKey、AppSecret → 保存

## 使用方式

**将机器人添加到钉钉群：**
- 群设置 → 智能群助手 → 添加机器人 → 选择应用机器人
- 机器人自动在 TeamAgentX 创建对应 ChatRoom

**群成员发送消息：**
```
@TeamAgentX @claude 帮我分析这份数据
@TeamAgentX @codex 优化这段 SQL
@TeamAgentX 项目进度如何          ← 触发默认助手
```

## Webhook 接收的消息格式

钉钉发送的消息回调：

```json
{
  "conversationId": "cidXxx",
  "conversationType": "2",
  "senderId": "user_xxx",
  "senderNick": "张三",
  "text": { "content": "@TeamAgentX @claude 帮我分析这份数据" },
  "atUsers": [
    { "dingtalkId": "bot_xxx", "staffId": "teamagentx" }
  ],
  "msgtype": "text"
}
```

## 注意事项

- 钉钉企业内部应用需要企业管理员在后台审批开通
- 机器人回调请求需要验证签名（时间戳 + Secret 的 HMAC-SHA256）
- 发送消息支持 Markdown 格式，适合展示代码块
- 单条消息内容上限 20000 字符
