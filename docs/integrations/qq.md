# QQ 集成

难度：★★☆☆☆ | 对接方式：QQ 开放平台 Bot | 方向：双向

QQ 开放平台于 2024 年正式开放群 Bot 能力，支持在 QQ 群中添加 AI 机器人。

## 注册 QQ Bot

1. 打开 [QQ 开放平台](https://q.qq.com)，使用 QQ 账号登录
2. 创建**机器人应用**，填写应用名称和描述
3. 在**事件订阅**中配置消息接收地址：
   ```
   https://your-domain.com/api/bridge/webhook/qq
   ```
4. 开启权限：
   - 群消息接收（`GROUP_AT_MESSAGE_CREATE`）
   - 群消息发送（`GROUP_MESSAGE_CREATE`）
5. 获取 **AppID** 和 **AppSecret**

## 配置到 TeamAgentX

1. TeamAgentX 后台 → 外部集成 → QQ
2. 填写 AppID、AppSecret → 保存

## 使用方式

**将机器人添加到 QQ 群：**
- 群成员在 QQ 群搜索 Bot → 点击添加（需群主/管理员审批）
- 机器人加入后自动在 TeamAgentX 创建对应 ChatRoom

**群成员发送消息：**
```
@TeamAgentX @claude 推荐几款学习编程的资源
@TeamAgentX @codex 帮我 debug 这段代码
@TeamAgentX 今天有什么新消息吗      ← 触发默认助手
```

## Webhook 接收的消息格式

QQ 开放平台消息事件：

```json
{
  "id": "event_xxx",
  "op": 0,
  "t": "GROUP_AT_MESSAGE_CREATE",
  "d": {
    "author": { "id": "user_xxx", "member_openid": "openid_xxx" },
    "content": "<@bot_id> @claude 帮我 debug 这段代码",
    "group_id": "group_xxx",
    "group_openid": "group_openid_xxx",
    "id": "msg_xxx",
    "timestamp": "2024-01-01T00:00:00+08:00"
  }
}
```

## 注意事项

- QQ Bot 目前处于**公测阶段**，部分功能可能随平台更新变化
- 群 Bot 需要群主或管理员审批后才能正常使用
- 消息内容中的 `@bot` 会以 `<@bot_id>` 格式出现，需要解析过滤
- 发送消息支持文本、图片、Markdown（需平台审核）
- QQ 频道和 QQ 群是两个独立的渠道，本文档仅覆盖 QQ 群场景
