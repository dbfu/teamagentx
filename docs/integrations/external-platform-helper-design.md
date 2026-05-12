# 外部平台接入助手设计

更新时间：2026-05-12

## 目标

把“外部平台接入”从一个后台配置页，升级成一个可以在群聊里直接完成配置的系统助手能力。

用户目标不是学会怎么配 `/integration`，而是：

1. 选定当前 TeamAgentX 房间或指定房间
2. 告诉系统要接入哪个外部平台
3. 按指引去外部平台拿到必要数据
4. 把数据回复给系统助手
5. 由系统助手把 TeamAgentX 内部配置一次性落好
6. 返回“下一步去外部群做什么”，直到最终完成映射

## 产品定义

系统助手名称：`外部平台接入`

定位：

- 不是纯说明机器人
- 不是单独的新页面
- 而是“接入顾问 + 配置执行器”

它应该同时承担两类职责：

1. **平台操作指导**
   - 告诉用户外部平台里应该去哪一步
   - 需要拿回哪些字段
   - 每个字段是做什么的

2. **系统内自动配置**
   - 保存平台凭证
   - 设置平台默认助手
   - 选择目标房间
   - 创建房间映射或生成绑定码
   - 查看/清理现有映射

## 系统结构

本次实现拆成四层：

1. **平台注册表**
   - 文件：`server/src/modules/bridge/bridge-platform-registry.ts`
   - 负责前后端共享平台基础元数据
   - 例如平台名、群 ID 提示、配置字段

2. **平台接入说明库**
   - 文件：`server/src/modules/bridge/bridge-platform-playbooks.ts`
   - 负责“外部平台上该怎么操作”的知识模型
   - 内容包括前置条件、必备凭证、后台操作步骤、绑定步骤、注意事项

3. **平台配置与绑定状态共享层**
   - 文件：
     - `server/src/modules/bridge/bridge-platform-config-store.ts`
     - `server/src/modules/bridge/bridge-bind-code-store.ts`
     - `server/src/modules/bridge/bridge-runtime-sync.ts`
   - 负责保存平台凭证、生成绑定码、同步平台运行态

4. **系统助手工具层**
   - 文件：`server/src/core/agent/tools/external-platform-helper.tools.ts`
   - 给系统助手暴露一组真实可执行工具

## 助手能力

当前助手支持：

- `get_current_chatroom`
  - 获取当前群聊上下文和已有外部映射
- `list_bridge_platforms`
  - 列出支持的平台和接入方式
- `get_bridge_platform_setup_guide`
  - 返回指定平台的详细接入步骤
- `get_bridge_platform_config_status`
  - 查看平台凭证是否已配置
- `save_bridge_platform_config`
  - 真正把用户给出的平台凭证写入系统
- `list_bridge_mappings`
  - 查询现有群聊映射
- `create_bridge_mapping`
  - 用户已知道外部群 ID 时直接建映射
- `generate_bridge_bind_code`
  - 用户还不知道外部群 ID 时生成绑定码
- `delete_bridge_mapping`
  - 删除现有映射

同时复用了：

- `list_chatrooms`
- `list_agents`

这样助手既能指导，也能落库。

## 交互流程

### 场景 1：用户要接 Telegram

1. 用户在 TeamAgentX 房间里说：`@外部平台接入 把这个群接到 Telegram`
2. 助手读取当前房间
3. 助手调用 `get_bridge_platform_setup_guide(telegram)`
4. 助手告诉用户：
   - 去 `@BotFather`
   - 创建机器人
   - 拿回 `Bot Token`
5. 用户把 `Bot Token` 发回来
6. 助手调用 `save_bridge_platform_config`
7. 助手调用 `generate_bridge_bind_code`
8. 助手回复：
   - TeamAgentX 已配置好 Telegram
   - 把机器人拉进目标群
   - 在群里发送 `/bind CODE`

### 场景 2：用户已知外部群 ID

1. 用户说：`把这个群映射到飞书 chat_id=oc_xxx`
2. 助手确认平台凭证已保存
3. 助手调用 `create_bridge_mapping`
4. 直接返回映射成功

### 场景 3：查看或清理

1. 用户说：`看一下这个群绑定了哪些外部平台`
2. 助手调用 `list_bridge_mappings`
3. 如果用户要删除，先确认，再调用 `delete_bridge_mapping`

## 运行态同步

仅保存凭证还不够。

本次在 `bridge-runtime-sync.ts` 里补了运行态收口：

- Telegram：保存凭证后尝试同步 webhook
- 飞书：保存凭证后自动启动或重启 WS 长连接
- 钉钉：保存凭证后自动启动或重启 Stream 长连接

这样通过系统助手保存平台凭证后，不需要再去后台点第二次“启用”。

## 企业微信处理

企业微信和普通 Bot 平台不同，除了 `corpId / agentSecret`，还常常需要：

- `token`
- `encodingAESKey`

这次已经补到：

- 平台接入说明里会明确要求这两个字段
- 平台注册表已补充这两个配置字段
- 系统助手可保存这些字段
- 企业微信加密消息解析会优先读取平台级 `encodingAESKey`
- 企业微信验签在没有群级 Secret 时，会回退使用平台级 `token`

这让企业微信至少具备“平台级先配通，再做房间映射”的能力。

## 当前边界

这次完成的是“TeamAgentX 内自动配置”。

仍然需要用户自己去外部平台完成的动作有：

- 注册/创建机器人或应用
- 打开平台后台权限
- 把机器人拉进目标群
- 从平台后台复制凭证

也就是说：

- **平台外动作**：还需要用户执行
- **TeamAgentX 内动作**：现在可以交给系统助手完成

## 下一步建议

如果继续往“完全不用自己配”推进，建议下一阶段补：

1. 平台 OAuth / 授权回调流程
   - 让部分平台通过授权而不是手抄密钥
2. 系统助手专用会话卡片
   - 展示“还缺哪些字段”“当前已完成到哪一步”
3. 映射向导 UI
   - 把聊天式助手和结构化表单结合
4. 接入诊断能力
   - 一键检查 webhook、长连接、验签、群映射状态
