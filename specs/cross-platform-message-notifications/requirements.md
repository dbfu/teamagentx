# Requirements Document: Cross Platform Message Notifications

**Generated**: 2026-05-28
**Mode**: iteration
**Depth**: M
**Status**: Draft

---

## 一、原始需求

> 给软件添加这种消息通知 [$deep-spec](/Users/liqing/.claude/skills/deep-spec/SKILL.md)
>
> 切换回 feature-lq   。所有的平台都需要支持。继续

截图表达的目标包括：
- macOS Dock / Windows 任务栏 / 支持平台的应用图标红色角标。
- 系统通知中心里展示来自 TeamAgentX 群聊的新消息摘要。
- Web、Electron 桌面、Flutter 移动端均需支持。

---

## 二、竞品基准研究

### 竞品参考

| 产品 | 解决方式 | 可提取的模式 |
|---|---|---|
| Slack | 用户可按频道、关键词、线程、移动端推送时机控制通知；桌面和移动端会同步未读提醒。来源: https://slack.com/hc/en-gb/articles/360025446073 | 系统通知与未读 badge 分工明确，避免所有消息同等打扰。 |
| Slack Engineering | 通知系统强调跨端状态、在线状态和重复通知控制。来源: https://slack.engineering/how-slack-rebuilt-notifications/ | 跨端通知应以统一事件和未读状态为基础。 |
| 浏览器 PWA / Badging API | 支持 `navigator.setAppBadge()` / `navigator.clearAppBadge()` 的环境可在安装型 Web App 图标上显示 badge。来源: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Display_badge_on_app_icon | Web badge 能力需做能力检测，不能视为所有浏览器都有。 |
| Windows App Badge | Windows 通知 badge 表示概要状态或数字。来源: https://learn.microsoft.com/en-us/windows/apps/develop/notifications/badges | Badge 只承载数量或状态，不承载复杂消息内容。 |

### 用户心智模型

用户看到应用图标上的红点或数字时，会认为存在尚未处理的新消息；打开对应会话并阅读后，红点或数字应消失。若系统通知弹出，用户会期待点击后进入对应群聊。

### 行业惯例

- Badge 表示未读数量或待处理状态，系统通知展示最新消息摘要，两者不互相替代。
- 已读状态必须跨端同步；同一账号在任一端读过消息后，其他端角标应更新。
- 通知内容要避免泄露过多敏感文本；锁屏或系统通知中心可能被旁人看到 [推演]。

### 已知反模式

- 所有消息都弹系统通知，导致用户关闭应用通知。
- Web、桌面、移动端分别维护通知计数，造成角标不一致。
- 在不支持 Web badge 的浏览器里静默失败，却不给用户任何降级行为。
- 已打开当前群聊时仍增加未读 badge，制造误报。

### 认知复杂度上限

成熟产品主流程为 2 步、1 个决策点：
1. 收到非当前会话新消息时展示通知/增加 badge。
2. 用户进入会话或标记已读后清除对应未读。

本需求设计不应引入超过 2 个用户决策点。

### 基准结论

- 与行业惯例对齐：以现有未读数为单一事实来源，同步驱动各端 badge。
- 偏离惯例风险：移动端完整系统推送通常需要 APNs/FCM 或平台推送服务；本期若只依赖 Socket，应用被系统杀死后无法保证收到通知 [推演]。
- 风险：Web badge 不是通用浏览器能力，需要明确降级为页面内未读数或浏览器通知。

---

## 三、官方文档核验

### 技术/平台: Electron App Badge

官方来源: https://www.electronjs.org/docs/latest/api/app

版本: 项目使用 `electron@^41.2.0`，按 Electron 当前官方稳定文档理解 [推演]

相关结论:
- Electron `app` 模块提供 `setBadgeCount(count)` / `getBadgeCount()`，用于设置应用图标 badge。
- macOS Dock badge 和部分 Linux 桌面环境支持数字 badge；Windows 支持能力依赖 AppUserModelID、通知/任务栏机制和安装形态 [推演]。

风险:
- Electron badge 是主进程能力，Web 渲染进程需要通过 preload IPC 调用。
- Windows 任务栏角标表现可能与 macOS Dock 不完全一致 [推演]。

### 技术/平台: Web Badging API

官方来源: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Display_badge_on_app_icon

版本: 项目使用 React `19.2.4`、Vite；Web badge 能力按浏览器实现判断。

相关结论:
- 支持环境可使用 `navigator.setAppBadge(count)` 和 `navigator.clearAppBadge()`。
- Web badge 主要面向已安装的 Web App / PWA 场景；普通浏览器标签页不保证显示应用图标 badge。

风险:
- 必须做 `setAppBadge` / `clearAppBadge` 能力检测。
- 不支持时降级为页面内未读数和浏览器通知，不得把 badge 显示作为硬性保证。

### 技术/平台: Web Notifications API

官方来源: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API

版本: 按当前浏览器官方稳定能力理解 [推演]

相关结论:
- 浏览器系统通知需要用户授权。
- 未授权或被拒绝时，Web 端不能弹系统通知，只能保留页面内未读提示。

风险:
- 权限请求应由用户操作触发，不能在页面加载时强制打扰 [推演]。

### 技术/平台: Flutter Platform Channels

官方来源: https://docs.flutter.dev/platform-integration/platform-channels

版本: 项目移动端为 Flutter，未在 `apps/mobile/pubspec.yaml` 发现本地通知插件；按 Flutter 官方平台通道能力理解 [推演]

相关结论:
- Flutter 可通过 platform channels 调用 iOS / Android 原生能力。
- 若不引入成熟通知插件，本期可通过平台通道实现应用内 badge/通知桥接，但维护成本较高 [推演]。

风险:
- 移动端后台/离线通知不能只靠 Socket，需要平台推送链路；若本期不引入 APNs/FCM，则能力边界必须写清。

### 技术/平台: Android Notification Badges

官方来源: https://developer.android.com/develop/ui/views/notifications/badges

版本: 按 Android 官方稳定文档理解 [推演]

相关结论:
- Android 8.0+ 通知渠道会影响 launcher badge；badge 通常与活跃通知相关。
- 不同 launcher 对 badge 展示存在差异。

风险:
- Android 不应承诺所有设备都显示一致的图标角标。

### 技术/平台: Apple Notifications / Badge

官方来源: https://developer.apple.com/documentation/usernotifications

版本: 按 Apple UserNotifications 官方稳定文档理解 [推演]

相关结论:
- iOS/macOS 通知和 badge 属于系统通知能力，需要用户授权。
- badge 数值应与应用未读状态一致 [推演]。

风险:
- iOS 后台通知与 badge 更新通常依赖 APNs；仅前台 Socket 不能覆盖所有后台场景 [推演]。

---

## 四、可行性 & 假设清单

### 假设提取

| # | Assumption | Risk if Wrong | Confidence |
|---|---|---|---|
| 1 | 现有 `unread:update` 事件可作为跨端通知 badge 的单一事实来源。 | 若未读数语义不完整，各端 badge 会出现错报。 | High |
| 2 | Web、桌面、移动端都已能接收 Socket 未读事件。 | 某端无法同步 badge，需要补事件接入。 | High |
| 3 | 用户希望收到的是群聊新消息通知，而非任务、待办、执行状态等所有事件 [推演]。 | 范围误判会导致实现后用户仍认为通知缺失。 | Medium |
| 4 | 移动端本期可先覆盖应用前台/后台存活状态，离线推送作为后续能力 [推演]。 | 若用户期待杀进程后也通知，需要引入 APNs/FCM，工作量升级。 | Medium |
| 5 | 通知摘要可显示群聊名和消息类型，图片消息显示 `[图片]`。 | 若展示完整消息内容，可能带来隐私风险。 | Medium |

### 技术可行性信号

- Current stack:
  - Server 已在 `server/src/socket/index.ts` 发送 `unread:update`。
  - Web 已在 `apps/web/src/App.tsx` 计算 `totalUnreadCount` 并显示页面内未读。
  - Desktop 已通过 `apps/desktop/electron/preload.ts` 暴露 Electron IPC API。
  - Mobile 已在 `apps/mobile/lib/stores/socket_store.dart` 监听 `unread:update` 并维护 `ChatStore.unreadCounts`。
- Known blockers:
  - Flutter 移动端当前未发现本地通知插件依赖；移动系统通知/badge 需要新增依赖或 platform channel。
  - Web badge 依赖浏览器支持，不能保证所有 Web 访问场景。
  - 离线移动推送需要 APNs/FCM 或其他推送服务，本期未见现有基础设施。
- Third-party dependencies:
  - Electron 原生能力：稳定。
  - Web Badging / Notifications API：能力依赖浏览器和授权。
  - Flutter 移动通知：需要选择插件或平台通道，需实现验证。
- Feasibility verdict: ✅ Clear path for unread-driven badge and in-app notification; ⚠️ mobile offline push needs separate push infrastructure.

### 依赖方识别

- 受影响模块：Web chat shell、Electron main/preload、Flutter mobile socket/chat stores、Server socket unread events。
- 受影响用户：桌面端协作者、Web 端协作者、移动端协作者。
- 上游依赖：`ChatRoomAgent.lastReadAt`、`Message.time`、`unread:update`、`chatroom:mark-read`。
- 下游依赖：侧边栏未读红点、应用图标 badge、系统通知显示。

### 范围边界

**In scope:**
- Web、Electron 桌面、Flutter 移动端基于未读总数显示应用级 badge 或可见降级提示。
- 收到非当前群聊新消息时，支持系统通知或平台可用的通知提示。
- 已读后跨端同步清除或减少 badge。
- 图片消息通知摘要显示为 `[图片]`。

**Out of scope (this iteration):**
- APNs / FCM 离线推送链路。原因：当前项目未见推送基础设施，接入会引入服务端 token、证书、权限和移动端生命周期复杂度。
- per-room / per-agent 通知偏好设置。原因：当前需求只要求“这种消息通知”且所有平台支持。
- 免打扰日程、关键词通知、通知聚合中心。原因：属于成熟通知系统的后续配置能力。

**Deliberately excluded:**
- 将通知用于营销、公告或非消息类推广。原因：会破坏消息通知的用户信任。

### 可逆性评分

| Dimension | Score | Reason |
|---|---|---|
| Data migration cost | Low | 本期优先复用现有未读状态，不要求新增表。 |
| API contract changes | Low | 可复用 `unread:update`，最多增加客户端 IPC/API。 |
| User-facing behavior change | Medium | 系统通知若过多会影响用户体验，需要默认策略保守。 |
| Downstream system impact | Low | 不改变消息发送主流程，只消费未读事件。 |

**Overall reversibility**: Medium cost

---

## 五、5W2H 全景分析

**What** — 做什么
> 为 TeamAgentX 增加跨 Web、Electron 桌面、Flutter 移动端的消息通知能力：收到非当前群聊新消息时更新应用 badge，并在平台允许时显示系统通知。

**Why** — 为什么做
> 用户需要在不盯着聊天窗口时及时发现新消息；截图显示用户明确希望获得类似系统消息中心和应用图标角标的提醒体验。

**Who** — 谁来用
> 主要用户: 使用 TeamAgentX 群聊协作的开发者 / 团队成员。  
> 次要用户: 在移动端查看群聊进展的团队成员 [推演]。  
> 受影响方: 负责维护桌面、Web、移动端构建的开发者 [推演]。

**When** — 什么时候用
> 触发时机: 用户不在对应群聊内，且该群聊产生新消息。  
> 使用频率: 高频，随群聊消息发生。  
> 时间约束: 未读数变化后 1 秒内更新应用内状态和 badge [推演]。

**Where** — 在哪里用
> 使用环境: Web 浏览器、Electron 桌面、Flutter iOS/Android。  
> 入口位置: 应用图标 badge、系统通知中心、应用侧边栏已有未读数。

**How** — 怎么做
> 核心操作路径: 系统收到 `unread:update` → 计算账号总未读数 → 更新当前平台 badge → 按权限显示系统通知 → 用户打开群聊 → 标记已读 → 清除或减少 badge。  
> 技术实现方向: 复用现有 Socket 未读事件，客户端按平台能力适配通知桥接，不新增服务端数据模型 [推演]。

**How Much** — 做到什么程度
> 规模/量级: 单账号所有加入群聊的未读总数。  
> 质量标准: badge 数值与页面侧边栏总未读一致；当前打开的群聊不增加未读。  
> 验收底线: 三端均能在支持的运行环境中展示未读提醒，不支持系统 badge 的环境有明确降级行为。

---

## 六、用户角色 & 使用场景

### 主要用户角色

| 字段 | 内容 |
|---|---|
| 角色名称 | 团队开发者 |
| 使用频率 | 高频（每天） |
| 技术熟练度 | 技术专家 |
| 核心目标 | 不打开 TeamAgentX 窗口也能发现群聊新消息。 |
| 最大痛点 | 需要手动切回应用检查是否有新消息，容易漏掉助手或同事回复 [推演]。 |

### 次要用户角色

| 字段 | 内容 |
|---|---|
| 角色名称 | 移动端协作者 |
| 使用频率 | 中频（每周） |
| 技术熟练度 | 普通用户 |
| 核心目标 | 离开电脑时仍能知道群聊有新消息。 |
| 最大痛点 | 移动端只能进应用后查看未读，缺少系统层提醒 [推演]。 |

### 受影响方

- 客户端开发者: 需要维护 Web、Desktop、Mobile 三端通知能力。
- 后端开发者: 需要保证未读事件语义稳定。

### 场景定义

| 场景 | 触发事件 | 用户目标 | 约束条件 |
|---|---|---|---|
| 桌面端后台收消息 | Electron 应用未聚焦，非当前群聊收到消息 | 通过 Dock/任务栏 badge 和系统通知发现消息 | 需遵守系统通知授权和平台 badge 能力 |
| Web 端收消息 | 浏览器打开 TeamAgentX，非当前群聊收到消息 | 在支持环境中看到浏览器通知或 PWA badge | Web badge 能力不保证所有浏览器支持 |
| 移动端收消息 | Flutter App 已登录并保持连接，非当前群聊收到消息 | 在系统通知或应用 badge 中看到提醒 | 离线/杀进程通知本期不保证 [推演] |
| 跨端已读同步 | 任一端打开对应群聊并标记已读 | 所有端 badge 数值减少或清除 | 依赖 `chatroom:mark-read` 和 `unread:update` |

---

## 七、核心痛点 & 业务价值

| 场景 | 现在的痛点 | 实现后的价值 | 不实现的负面影响 |
|---|---|---|---|
| 桌面端后台收消息 | 开发者需要主动切回窗口检查消息，若专注在 IDE/终端中可能错过回复 [推演]。 | 新消息出现时通过系统层提示发现，减少手动检查。 | 群聊协作响应延迟持续存在，用户会认为桌面版“不像聊天软件”。 |
| Web 端收消息 | 浏览器标签不在前台时，只靠页面内未读数不可见 [推演]。 | 支持浏览器通知/PWA badge 的环境能在应用外看到提醒。 | Web 用户在多标签工作流中漏看消息。 |
| 移动端收消息 | 移动端需要打开 App 才能确认未读 [推演]。 | App 存活并连接时可显示移动通知或 badge。 | 离开电脑后无法及时知道群聊更新。 |
| 跨端已读同步 | 若各端分别计数，已读后其他端仍显示红点，会造成误报 [推演]。 | 任一端阅读后各端同步未读状态。 | 用户对通知数字失去信任。 |

价值可信度:
- ⚠️ 以上痛点基于协作消息产品行业经验和现有未读功能推断 [推演]。
- ✅ Must 项证据来自用户明确要求“所有的平台都需要支持”和截图中的系统通知 / 应用角标。

---

## 八、标准用户故事 & 验收标准

### Story 1

**User Story**: 作为团队开发者，我想要桌面端在后台收到消息时显示系统通知和应用角标，以便不切回窗口也能知道有新消息。

**Acceptance Criteria**:
- [ ] AC1: When Electron app is running and a non-selected chatroom receives an `unread:update` count greater than 0, the desktop app shall set the application badge to the total unread count within 1 second.
- [ ] AC2: When the user opens the chatroom that produced the unread count, the desktop app shall receive the updated unread count and reduce or clear the application badge within 1 second.
- [ ] AC3: When the incoming message attachment type is image-only, the desktop notification body shall contain `[图片]` instead of an empty message body.
- [ ] AC4: While the current selected chatroom receives a message, the desktop app shall keep that chatroom unread count at 0.

**Out of scope for this story**: Per-room notification preference, quiet hours, offline push.

### Story 2

**User Story**: 作为团队开发者，我想要 Web 端在浏览器支持时显示系统通知或 PWA badge，以便在其他标签页工作时看到新消息。

**Acceptance Criteria**:
- [ ] AC5: When `navigator.setAppBadge` is available and total unread count is greater than 0, the Web app shall call badge update with the total unread count.
- [ ] AC6: When `navigator.clearAppBadge` is available and total unread count becomes 0, the Web app shall clear the badge.
- [ ] AC7: When Web notification permission is not granted, the Web app shall not create a browser notification.
- [ ] AC8: When Web badge APIs are unavailable, the Web app shall continue to display existing in-app unread counts without throwing a runtime error.

**Out of scope for this story**: Service Worker push for closed browsers.

### Story 3

**User Story**: 作为移动端协作者，我想要移动端收到非当前群聊消息时显示通知或角标，以便离开电脑时也能发现群聊更新。

**Acceptance Criteria**:
- [ ] AC9: When Flutter app is connected and a non-current chatroom receives unread count greater than 0, the mobile app shall update app-level unread badge state to the total unread count where the platform supports it.
- [ ] AC10: When the mobile user opens a chatroom and `chatroom:mark-read` succeeds, the mobile app shall update the badge state after receiving the matching `unread:update`.
- [ ] AC11: When the platform does not support numeric launcher badge, the mobile app shall still maintain in-app unread counts.
- [ ] AC12: When the app process is terminated, this iteration shall not guarantee delivery of new message notifications.

**Out of scope for this story**: APNs/FCM remote push, notification action buttons.

### Story 4

**User Story**: 作为客户端开发者，我想要三端共用服务端未读状态，以便通知数字和应用内未读数字一致。

**Acceptance Criteria**:
- [ ] AC13: When the server emits `unread:update` with `{ unreadCounts }`, each client shall derive total unread count by summing non-negative room counts.
- [ ] AC14: When the server emits `unread:update` with `{ chatRoomId, count }`, each client shall update only that chatroom count.
- [ ] AC15: When count is missing, negative, or not a number, the client shall ignore that field and keep the previous valid count.

**Out of scope for this story**: Changing the database unread model.

### Decision Log

| Decision | Alternatives Considered | Why This Choice |
|---|---|---|
| Use existing `unread:update` as source of truth | Add new notification table or new Socket event | Existing server and clients already maintain unread counts; new model is unnecessary for current scope. |
| Treat offline mobile push as out of scope | Add APNs/FCM now | Current repo has no push infrastructure; adding it would expand backend auth/token/certificate scope. |
| Use platform capability detection | Assume all platforms support badge | Official docs show Web and Android badge behavior varies by environment. |

---

## 九、MoSCoW 优先级

### Must (必须做)

| # | Requirement | Evidence |
|---|---|---|
| M1 | Electron 桌面端显示应用 badge，并在系统允许时显示消息通知。 | 用户截图明确展示 Dock badge 和系统通知；Electron 官方支持 app badge。 |
| M2 | Web 端支持浏览器通知 / PWA badge 的能力检测与降级。 | 用户明确要求所有平台支持；Web Badging API 支持受限，必须降级。 |
| M3 | Flutter 移动端基于未读数维护通知/badge 状态，平台不支持时保留应用内未读。 | 用户明确要求所有平台支持；Android/iOS badge 受系统能力限制。 |
| M4 | 三端 badge 数值与现有总未读数一致。 | Slack 等成熟协作产品行业惯例；现有系统已有未读数基础。 |
| M5 | 已读后跨端清除或减少 badge。 | 行业惯例；否则通知数字失真。 |

### Should (应该做)

| # | Requirement | Why Not Must |
|---|---|---|
| S1 | 通知正文对图片消息显示 `[图片]`。 | 用户截图展示图片消息摘要，但核心目标是通知存在和未读提示。 |
| S2 | 通知点击后跳转对应群聊。 | 行业常见体验，但截图未明确要求点击行为。 |
| S3 | 通知权限入口放在设置页。 | 有助于用户控制，但不是 badge 核心链路。 |

### Could (可做可不做)

| # | Requirement | Deferral Reason |
|---|---|---|
| C1 | 通知声音开关。 | 项目设置页已有声音图标线索，但当前需求未要求。 |
| C2 | 每个群聊展示最近一条通知预览聚合。 | 增加 UI 和状态复杂度，本期不需要。 |

### Won't (本期不做)

| # | Requirement | Decision Reason |
|---|---|---|
| W1 | APNs/FCM 离线移动推送。 | 当前无推送基础设施，超出“添加这种通知”的最小范围。 |
| W2 | per-room/per-agent 通知偏好。 | 用户未提出，当前 AC 不依赖。 |
| W3 | 免打扰日程、关键词通知、通知聚合中心。 | 属于成熟通知系统后续迭代。 |
| W4 | 新增通知数据库表。 | 现有未读状态足够支撑本期。 |

### YAGNI Flags

- APNs/FCM 离线推送 → Moved to Won't. Reason: 当前没有离线通知验收标准。
- per-room/per-agent 通知设置 → Moved to Won't. Reason: 当前只有一个全局通知需求。
- 新通知中心数据模型 → Moved to Won't. Reason: 现有 `unread:update` 可满足 badge 和通知触发。

---

## 十、功能详细需求定义

### 功能 1: 统一未读总数计算

**功能描述**
> 客户端从服务端 `unread:update` 事件维护按群聊分组的未读数，并计算应用级总未读数。

**输入**

| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| unreadCounts | Record<string, number> | 否 | key 为 chatRoomId，value 为 0..99999 | 批量未读数 |
| chatRoomId | string | 否 | 非空字符串 | 单个群聊 ID |
| count | number | 否 | 0..99999 | 单个群聊未读数 |
| selectedRoomId/currentChatRoomId | string/null | 否 | 非空字符串或 null | 当前打开群聊 |

**处理逻辑**
1. 如果输入包含 `unreadCounts`，客户端替换本地未读映射。
2. 如果输入包含 `chatRoomId` 和合法 `count`，客户端只更新该群聊未读数。
3. 如果 `chatRoomId` 等于当前打开群聊，客户端将该群聊本地未读数保持为 0。
4. 客户端将所有非负 count 求和作为 totalUnreadCount。

**输出**

| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 更新后的 totalUnreadCount | number |
| 失败 | 忽略非法字段并保留旧值 | 无用户可见错误 |

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 输入为空 | 不更新未读数 |
| count 为负数或非数字 | 忽略该字段 |
| 并发请求 | 以后收到的 `unread:update` 为准 [推演] |
| 网络超时 | 保留本地最后一次有效未读数 |
| 权限不足 | Socket 已鉴权失败时不处理未读事件 |

**与其他功能的依赖关系**
- 依赖: 服务端现有 `unread:update`。
- 被依赖: 桌面 badge、Web badge、移动端 badge、系统通知。

### 功能 2: Electron 桌面 badge 和系统通知

**功能描述**
> Electron 桌面端根据 totalUnreadCount 更新 Dock/任务栏 badge，并在新消息来自非当前群聊时展示系统通知。

**输入**

| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| totalUnreadCount | number | 是 | 0..99999 | 应用总未读数 |
| messagePreview | string | 否 | 0..120 字符 | 通知摘要 |
| chatRoomName | string | 否 | 0..80 字符 | 通知标题组成 |
| isFocused | boolean | 是 | true/false | 应用窗口是否聚焦 [推演] |

**处理逻辑**
1. totalUnreadCount 大于 0 时，主进程设置应用 badge 为该数字。
2. totalUnreadCount 等于 0 时，主进程清除应用 badge。
3. 新消息来自非当前群聊且系统允许通知时，显示系统通知。
4. 图片消息无文本时，通知正文使用 `[图片]`。

**输出**

| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 系统 badge/通知更新 | 平台 UI |
| 失败 | 记录日志，不阻塞聊天收发 | debug log |

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 输入为空 | 不更新 badge |
| 超出取值范围 | 显示 `99+` 或平台允许的最大表现 [推演] |
| 并发请求 | 使用最近一次 totalUnreadCount |
| 网络超时 | 不新增通知，保留最后 badge |
| 权限不足 | 不显示系统通知，仍更新应用内未读 |

**与其他功能的依赖关系**
- 依赖: 功能 1。
- 被依赖: 桌面用户感知提醒。

### 功能 3: Web badge 和浏览器通知

**功能描述**
> Web 端在浏览器支持时更新 PWA badge，并在用户授权后显示浏览器通知；不支持时保留现有页面内未读数。

**输入**

| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| totalUnreadCount | number | 是 | 0..99999 | 应用总未读数 |
| notificationPermission | string | 是 | granted/default/denied | 浏览器通知权限 |
| badgeApiAvailable | boolean | 是 | true/false | 是否支持 Web Badging API |
| messagePreview | string | 否 | 0..120 字符 | 通知摘要 |

**处理逻辑**
1. 如果 `setAppBadge` 可用且 totalUnreadCount 大于 0，设置 Web badge。
2. 如果 `clearAppBadge` 可用且 totalUnreadCount 等于 0，清除 Web badge。
3. 如果通知权限为 `granted` 且消息来自非当前群聊，显示浏览器通知。
4. 如果权限为 `default` 或 `denied`，不显示浏览器通知。

**输出**

| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | badge/浏览器通知更新 | 浏览器 UI |
| 失败 | 无运行时错误，保留页面内未读 | UI 状态 |

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 输入为空 | 不更新 badge |
| API 不存在 | 跳过 badge 调用 |
| 并发请求 | 使用最新 totalUnreadCount |
| 网络超时 | 保留页面内最后未读数 |
| 权限不足 | 不显示浏览器通知 |

**与其他功能的依赖关系**
- 依赖: 功能 1。
- 被依赖: Web 用户提醒。

### 功能 4: Flutter 移动端通知和 badge

**功能描述**
> 移动端在 App 已连接时根据未读数更新平台支持的 badge 或应用内未读提示，并在系统允许时显示本地通知。

**输入**

| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| totalUnreadCount | int | 是 | 0..99999 | 应用总未读数 |
| currentChatRoomId | string/null | 否 | 非空字符串或 null | 当前打开群聊 |
| messagePreview | string | 否 | 0..120 字符 | 通知摘要 |
| appLifecycleState | string | 是 | foreground/background/inactive | App 生命周期状态 [推演] |

**处理逻辑**
1. App 已连接 Socket 时，按功能 1 更新未读状态。
2. 平台支持 badge 时，设置 badge 为 totalUnreadCount。
3. 平台不支持 badge 时，只更新应用内未读数。
4. App 进程终止时，本期不保证收到新消息通知。

**输出**

| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 移动端 badge 或应用内未读更新 | 平台 UI / App UI |
| 失败 | 保留应用内未读数 | App UI |

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 输入为空 | 不更新 badge |
| 平台不支持数字 badge | 保留应用内未读数 |
| 并发请求 | 使用最新 totalUnreadCount |
| 网络超时 | 保留最后一次有效未读数 |
| 权限不足 | 不显示系统通知，保留应用内未读 |

**与其他功能的依赖关系**
- 依赖: 功能 1。
- 被依赖: 移动端消息提醒。

---

## 十一、非功能需求

### Performance (性能)
- Response time: 收到 `unread:update` 后，应用内未读和 badge 状态应在 1 秒内更新 [推演]。
- Throughput: 遵循现有 Socket 消息吞吐，无新增服务端轮询。
- Data volume: 单账号按加入群聊数量维护 unread map。
- Degradation behavior: 平台通知 API 失败时，聊天收发和应用内未读不受影响。

### Security (安全)
- Authentication: 仅处理已通过 Socket JWT 鉴权的 `unread:update`。
- Authorization: 客户端不得为非当前账号的 chatRoomId 展示通知。
- Data sensitivity: 系统通知可能在锁屏可见；默认摘要应控制长度，图片消息显示 `[图片]` [推演]。
- Attack surface: Web 通知内容不得插入 HTML；通知标题和正文按纯文本处理。
- Audit trail: 通知 API 调用失败记录客户端日志即可，不新增审计表。

### Compatibility (兼容性)
- Browser/platform targets: Web 浏览器、Electron macOS/Windows/Linux、Flutter iOS/Android。
- API versioning: 不改变现有 `unread:update` 事件结构。
- Data format compatibility: 继续使用 `{ unreadCounts }` 和 `{ chatRoomId, count }` 两种现有格式。
- Third-party integration constraints: Web badge、系统通知、Android launcher badge 均需做能力检测。

### Usability (易用性)
- Learnability: 用户无需学习新流程，看到 badge 后打开对应群聊即可清除未读。
- Error recovery: 通知权限被拒绝时，应用仍保留页面内未读提示。
- Accessibility: 通知正文为可读文本，不仅依赖颜色或红点表达。
- Mobile/responsive: 移动端 App 内未读数继续可见。

### Maintainability (可维护性)
- Code coverage expectation: 未读总数计算和非法 count 处理应有单元测试 [推演]。
- Documentation requirements: 新增 IPC / 平台桥接 API 需在类型定义中说明。
- Observability: 通知权限或平台 API 调用失败记录 debug 日志。
- Deployment: 功能可通过客户端回退，不要求数据库迁移。

### Scalability & Extensibility (可扩展性)
- Growth assumptions: 未来可扩展到 per-room 通知偏好，但本期不实现。
- Extension points: 通知展示逻辑可在客户端以平台 adapter 隔离。
- Configuration vs code: 本期默认策略写死为“非当前群聊新消息触发”；后续再配置化。
- Multi-tenancy: 不涉及多租户新增逻辑。

---

## 十二、架构影响分析 [Iteration Mode]

[本档不适用]

M 档未执行完整架构影响模型，但已完成 GitNexus 代码库扫描：
- `apps/web/src/stores/socket-store.ts:onUnreadUpdate` impact: LOW，direct callers 0，affected processes 0。
- `server/src/socket/index.ts:setupSocket` impact: LOW，direct callers 0，affected processes 0。
- `gitnexus detect_changes --staged`: No changes detected。

相关现有代码:
- `server/src/socket/index.ts` 已在新消息和已读时发送 `unread:update`。
- `apps/web/src/App.tsx` 已计算 `totalUnreadCount`。
- `apps/mobile/lib/stores/socket_store.dart` 已监听 `unread:update`。
- `apps/desktop/electron/preload.ts` 已有 Electron API 暴露模式，可扩展通知 IPC。

---

## 十三、认知复杂度评估

[本档不适用]

---

## 十四、YAGNI 审查

### 已通过 YAGNI 审查的需求项（确认保留）

| 需求项 | 保留理由 | 对应验收标准 |
|---|---|---|
| 统一未读总数计算 | 三端 badge 必须一致 | AC13-AC15 |
| Electron badge/通知 | 用户截图直接指向桌面 badge 和系统通知 | AC1-AC4 |
| Web badge/通知能力检测 | 用户要求所有平台支持，Web 能力有兼容限制 | AC5-AC8 |
| Flutter 移动端 badge/通知 | 用户明确要求所有平台支持 | AC9-AC12 |
| 图片消息摘要 `[图片]` | 用户截图展示图片消息通知 | AC3 |

### Deferred 项（推测性/过度设计，本期不做）

| 需求项 | 标记原因 | 触发条件 |
|---|---|---|
| APNs/FCM 离线推送 | 当前 AC 明确不保证进程终止后的通知 | 用户要求 App 被杀死/离线时仍收到通知 |
| per-room/per-agent 通知偏好 | 当前只有全局通知需求 | 用户要求按群聊或助手设置通知策略 |
| 免打扰日程 | 用户未提出，删掉不影响 AC | 用户要求夜间静音或工作时间策略 |
| 新通知中心数据模型 | 现有未读事件可满足当前需求 | 需要历史通知列表、已读通知审计或通知聚合 |

### 扩展预留建议（架构层面）

| 扩展点 | 预留方式 | 为什么现在就要预留 |
|---|---|---|
| 平台通知适配 | 客户端按 Web/Desktop/Mobile adapter 分离 | 各平台 API 差异明显，混在业务组件里会难维护 |
| 通知权限状态 | 以客户端状态封装，不写入服务端 | 权限是设备级/浏览器级，不应作为账号全局事实 |

---

## 十五、扩展预留建议

**架构扩展点**:
- 通知 adapter: Web 使用 Badging/Notifications API，Desktop 使用 Electron IPC，Mobile 使用 Flutter 插件或 platform channel。
- 通知触发输入统一为 `{ chatRoomId, count, totalUnreadCount, messagePreview }` [推演]。

**后续迭代方向**:
- APNs/FCM 离线推送 — 触发条件: 用户要求 App 关闭后仍收到移动端通知。
- per-room/per-agent 通知偏好 — 触发条件: 用户要求不同群聊/助手不同通知等级。
- 免打扰日程 — 触发条件: 用户反馈通知过多或需要工作时间控制。

**配置化建议**:
- 本期不新增服务端配置。
- 客户端可保留本地通知权限/开启状态，后续再同步为账号设置。

---

## 十六、决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 使用现有未读状态驱动通知 | 新增 Notification 模型 | 当前需求只要求新消息提醒和 badge，未读数已经存在。 | 2026-05-28 |
| 三端分别用平台 adapter | 写一套通用 UI 逻辑直接调用各平台 API | 平台能力差异大，adapter 更利于隔离兼容判断。 | 2026-05-28 |
| 本期不做离线移动推送 | 立即接入 APNs/FCM | 当前缺少推送基础设施，且会扩大数据模型和部署范围。 | 2026-05-28 |
| badge 与系统通知职责分开 | 只做通知弹窗或只做 badge | 用户截图同时体现两者，成熟产品也将它们分工处理。 | 2026-05-28 |

---

## 自检清单

─ 全档位必查 ──────────────────────────────
- [x] Step 0a: 核心功能关键词已提取并记录。
- [x] Step 0b: 执行模式已输出。
- [x] Step 0c: 需求规模评估卡已输出，用户已确认 M 档。
- [x] Phase 1a: 原始需求已保留。

─ S 档及以上额外检查 ──────────────────────
- [x] Phase 0.6: 涉及 Electron / Web / Flutter / Android / Apple 官方文档，已核验或标注推演风险。
- [x] Phase 1b: 可逆性评分已给出。
- [x] 2.1 5W2H: 7 个维度全部有内容，推演已标注。
- [x] 2.3 AC: 均无 fast/easy/simple/reasonable/intuitive/normal/good/appropriate/timely。
- [x] 2.4 MoSCoW: Must 项均有证据。
- [x] 2.12 功能详细定义: 每条含边界情况说明。

─ M 档及以上额外检查 ──────────────────────
- [x] Phase 0.5: 竞品基准完成。
- [x] Phase 1b: 假设清单已列出。
- [x] 2.2 用户角色: 至少 1 个具体职位名称。
- [x] 2.7 痛点&价值: 每个场景有具体痛点，已标注可信度。
- [x] 2.9 YAGNI: 已逐条检查，Deferred 项已同步到 MoSCoW Won't。
- [x] 2.11 NFR: 所有 6 个分类均有内容。

---

## 预留扩展位

<!-- 新增分析维度在此添加，不改动上方结构 -->
