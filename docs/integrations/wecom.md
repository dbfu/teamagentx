# 企业微信集成

难度：★★★☆☆ | 对接方式：企业微信应用 | 方向：双向

## 前提条件

- 需要企业微信认证的企业账号
- 企业管理员权限

## 创建企业微信应用

1. 打开[企业微信管理后台](https://work.weixin.qq.com/wework_admin)
2. 应用管理 → 创建应用 → 选择**机器人**或**自建应用**
3. 在应用设置中配置消息接收：
   - 接收消息 URL：`https://your-domain.com/api/bridge/webhook/wecom`
   - Token 和 EncodingAESKey 由系统生成，填入后台保存
4. 开启权限：
   - 发送消息到群聊（`EXTERNAL_CHAT`）
   - 读取成员信息

5. 获取 **Corp ID**、**Agent ID**、**Agent Secret**

## 配置到 TeamAgentX

1. TeamAgentX 后台 → 外部集成 → 企业微信
2. 填写 Corp ID、Agent ID、Agent Secret、Token、EncodingAESKey → 保存

## 使用方式

**将应用添加到企业微信群：**
- 在企业微信群中，点击 `+` → 添加机器人 → 选择已创建的应用
- 机器人自动在 TeamAgentX 创建对应 ChatRoom

**群成员发送消息：**
```
@TeamAgentX @claude 帮我写周报
@TeamAgentX @codex 把这段代码重构一下
@TeamAgentX 下周的计划安排        ← 触发默认助手
```

## Webhook 接收的消息格式

企业微信消息回调（XML 格式，需解密）：

```xml
<xml>
  <ToUserName>ww_corp_id</ToUserName>
  <FromUserName>user_xxx</FromUserName>
  <CreateTime>1706000000</CreateTime>
  <MsgType>text</MsgType>
  <Content>@TeamAgentX @claude 帮我写周报</Content>
  <ChatId>group_xxx</ChatId>
  <MsgId>msg_xxx</MsgId>
</xml>
```

## 注意事项

- 企业微信消息回调使用 **AES 加密**，需用 EncodingAESKey 解密
- 应用消息发送有频率限制：每个应用每天可发送消息数有上限
- 企业微信群机器人（Webhook 单向）适合简单通知场景，双向集成需使用企业应用
- 外部群（含外部联系人）需要额外配置外部联系人权限
