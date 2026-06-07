import type { ReactNode } from 'react'

export const GITHUB_URL = 'https://github.com/dbfu/teamagentx'

// ── 功能特性（多语言）──
const featuresZh = [
  ['多模型统一接入', '支持 Claude、GPT、DeepSeek、Qwen、GLM 等 50+ 主流模型，填入 API Key 即可接入，统一管理并发与权限。', '50+ 模型', 'blue'],
  ['专属 Agent 角色', '为每个助手定制系统提示词、工具权限和执行策略，打造具备专业能力的 AI 团队成员。', '角色定制', 'purple'],
  ['多 Agent 实时协作', '在群聊中 @ 任意 Agent，多个助手同时工作——调研、撰写、审核，自动接力完成复杂任务。', '并行执行', 'green'],
  ['任务队列 & 定时任务', '任务自动入队顺序执行，Cron 定时触发，中断后可恢复。Agent 在后台持续自动运转，无需人工守候。', '全自动化', 'amber'],
  ['长期房间记忆', '每个 Agent 在每个聊天室维护独立记忆，跨会话积累上下文，持续学习房间背景与偏好。', '持续学习', 'blue'],
  ['全链路透明追踪', '实时查看 Agent 思考过程、工具调用链路、执行状态和 Token 消耗，完整可溯每一步链路。', '透明可控', 'purple'],
] as const

const featuresEn = [
  ['Multi-Model Integration', 'Support Claude, GPT, DeepSeek, Qwen, GLM and 50+ mainstream models. Enter API Key to connect, unified concurrency and permission management.', '50+ Models', 'blue'],
  ['Custom Agent Roles', 'Configure system prompts, tool permissions, and execution policies for each assistant. Build AI team members with professional capabilities.', 'Role Custom', 'purple'],
  ['Multi-Agent Collaboration', '@ any Agent in chatrooms, multiple assistants work simultaneously—research, writing, review, automatically relay to complete complex tasks.', 'Parallel Exec', 'green'],
  ['Task Queue & Cron', 'Tasks automatically queue for sequential execution, Cron triggers on schedule, resumable after interruption. Agents run continuously without manual supervision.', 'Auto Pilot', 'amber'],
  ['Long-term Room Memory', 'Each Agent maintains independent memory per chatroom, accumulates context across sessions, continuously learns room background and preferences.', 'Continuous', 'blue'],
  ['Full-chain Transparency', 'Real-time view of Agent thinking process, tool call chain, execution status and token consumption. Every step fully traceable.', 'Transparent', 'purple'],
] as const

export function getFeatures(lang: string) {
  return lang === 'zh' ? featuresZh : featuresEn
}

// ── 工作流程（多语言）──
const workflowZh = [
  ['01', '接入模型', '填入任意 AI 模型的 API Key，支持 Anthropic、OpenAI 协议及国内主流供应商，统一管理。', 'blue'],
  ['02', '创建 Agent', '为助手配置角色、提示词和工具权限，定义其专业领域和能力边界。', 'purple'],
  ['03', '组建聊天室', '创建群聊或快捷对话，邀请多个 Agent 加入，设定协作规则和工作目录。', 'green'],
  ['04', '下达任务', '发送一条消息，AI 团队自动拆解、分配、并行执行，实时汇报进展。', 'amber'],
] as const

const workflowEn = [
  ['01', 'Connect Models', 'Enter API Key for any AI model. Supports Anthropic, OpenAI protocols and mainstream providers, unified management.', 'blue'],
  ['02', 'Create Agents', 'Configure role, prompts, and tool permissions for assistants. Define their domain expertise and capability boundaries.', 'purple'],
  ['03', 'Build Chatrooms', 'Create group chats or quick conversations, invite multiple Agents, set collaboration rules and working directory.', 'green'],
  ['04', 'Assign Tasks', 'Send one message, AI team automatically decomposes, distributes, executes in parallel, reports progress in real-time.', 'amber'],
] as const

export function getWorkflow(lang: string) {
  return lang === 'zh' ? workflowZh : workflowEn
}

// ── 协作演示列表（多语言）──
const showcaseZh = [
  '场景无限制：需求分析、架构设计、代码开发、自动化测试、部署发布——完整软件开发流程全自动',
  '多 Agent 接力协作：产品经理梳理需求，架构师设计方案，前端后端并行开发，测试验证，运维部署',
  '全程透明可控：实时查看每个 Agent 的思考过程和工具调用，随时干预或调整方向',
  '定时自动运行：配置 Cron 定时任务，让 Agent 定期生成报表、监控数据、推送摘要，7×24 小时运转',
]

const showcaseEn = [
  'Unlimited scenarios: requirement analysis, architecture design, coding, automated testing, deployment—complete software development lifecycle automated',
  'Multi-Agent relay collaboration: PM analyzes requirements, Architect designs, Frontend/Backend develop in parallel, QA verifies, DevOps deploys',
  'Fully transparent and controllable: real-time view of each Agent\'s thinking process and tool calls, intervene or adjust direction anytime',
  'Scheduled auto-run: configure Cron tasks, let Agents periodically generate reports, monitor data, push summaries, 24/7 operation',
]

export function getShowcase(lang: string) {
  return lang === 'zh' ? showcaseZh : showcaseEn
}

// ── 开源免费卡片（多语言）──
const openSourceItemsZh = [
  { icon: 'free', title: '永久免费', desc: '所有功能完全免费使用，无功能限制，无试用期，无隐藏收费，当前阶段不设任何付费计划。', tag: '0 元', tone: 'green' },
  { icon: 'opensource', title: 'MIT 开源', desc: '完整源代码在 GitHub 公开，MIT 协议授权，可自由部署、二次开发和商业使用，欢迎 PR 贡献。', tag: 'MIT License', tone: 'blue' },
  { icon: 'selfhost', title: '私有化部署', desc: '本地 SQLite 数据库，数据完全存储在自己的设备上，也支持桌面端一键安装，无需服务器。', tag: '数据自主', tone: 'purple' },
] as const

const openSourceItemsEn = [
  { icon: 'free', title: 'Free Forever', desc: 'All features completely free to use, no feature limits, no trial period, no hidden charges. No payment plans at current stage.', tag: '$0', tone: 'green' },
  { icon: 'opensource', title: 'MIT Open Source', desc: 'Full source code publicly available on GitHub, MIT license. Free to deploy, modify, and commercialize. PR contributions welcome.', tag: 'MIT License', tone: 'blue' },
  { icon: 'selfhost', title: 'Self-hosted', desc: 'Local SQLite database, data completely stored on your own device. Desktop one-click installation, no server needed.', tag: 'Data Owner', tone: 'purple' },
] as const

export function getOpenSourceItems(lang: string) {
  return lang === 'zh' ? openSourceItemsZh : openSourceItemsEn
}

// ── showcase 静态卡片（多语言）──
const demoCardsZh = [
  { avatar: '产', name: '产品经理', date: '5月31日', time: '14:20', text: '「用户登录功能」需求文档已完成：支持手机号/邮箱登录、记住密码、第三方登录，已创建开发 Issue。@架构师 请开始架构设计。', tone: 'green', tools: ['Write', 'Read'], running: false, duration: '48s', tokens: '12.6K' },
  { avatar: '架', name: '架构师', date: '5月31日', time: '14:24', text: '架构设计完成，build 通过无报错，已将需求拆分为 UI、后端、前端、测试 4 个子任务并创建 Issue。@UI设计 @后端开发 @前端开发 @测试 请认领。', tone: 'blue', tools: ['Bash', 'Write'], running: false, duration: '1m12s', tokens: '38.2K' },
  { avatar: 'U', name: 'UI设计', date: '5月31日', time: '14:30', text: '登录页 HTML 原型图已生成，自动打开浏览器预览，交互稿已同步给前端。', tone: 'pink', tools: ['Write'], running: false, duration: '52s', tokens: '15.1K' },
  { avatar: '后', name: '后端开发', date: '5月31日', time: '14:38', text: '登录接口开发完成，本地服务正常启动，已提供联调文档。@前端开发 可对接。', tone: 'orange', tools: ['Bash', 'Read'], running: false, duration: '2m05s', tokens: '44.7K' },
  { avatar: '前', name: '前端开发', date: '5月31日', time: '14:45', text: '已按原型图开发登录页并对接后端接口，本地服务正常启动，等待 @架构师 Review。', tone: 'purple', tools: ['Bash', 'Read'], running: false, duration: '1m41s', tokens: '33.5K' },
  { avatar: '架', name: '架构师', date: '5月31日', time: '14:50', text: '代码 Review 通过，结构清晰、接口规范，已 push 到 GitHub。@运维 请开始部署。', tone: 'blue', tools: ['Read'], running: false, duration: '34s', tokens: '9.8K' },
  { avatar: '运', name: '运维', date: '5月31日', time: '14:54', text: '源码方式部署完成，应用地址：http://203.0.113.42:8080。@测试 请开始自动化验证。', tone: 'amber', tools: ['Bash'], running: false, duration: '3m18s', tokens: '21.4K' },
  { avatar: '测', name: '测试', date: '5月31日', time: '15:00', text: '自动化测试执行完成，用例全部通过，功能验证成功，Issue 已关闭。', tone: 'teal', tools: ['Bash', 'Read'], running: false, duration: '1m53s', tokens: '28.9K' },
] as const

const demoCardsEn = [
  { avatar: 'PM', name: 'PM', date: 'May 31', time: '14:20', text: 'User login feature requirement doc completed: supports phone/email login, remember password, third-party login. Dev Issue created. @Architect Please start architecture design.', tone: 'green', tools: ['Write', 'Read'], running: false, duration: '48s', tokens: '12.6K' },
  { avatar: 'A', name: 'Architect', date: 'May 31', time: '14:24', text: 'Architecture design complete, build passed with no errors. Requirement split into UI, Backend, Frontend, QA 4 subtasks, Issues created. @UI @Backend @Frontend @QA Please claim.', tone: 'blue', tools: ['Bash', 'Write'], running: false, duration: '1m12s', tokens: '38.2K' },
  { avatar: 'U', name: 'UI Designer', date: 'May 31', time: '14:30', text: 'Login page HTML prototype generated, browser preview opened automatically. Interaction mock synced to frontend.', tone: 'pink', tools: ['Write'], running: false, duration: '52s', tokens: '15.1K' },
  { avatar: 'BE', name: 'Backend Dev', date: 'May 31', time: '14:38', text: 'Login API development complete, local server started normally. Integration doc provided. @Frontend Can connect.', tone: 'orange', tools: ['Bash', 'Read'], running: false, duration: '2m05s', tokens: '44.7K' },
  { avatar: 'FE', name: 'Frontend Dev', date: 'May 31', time: '14:45', text: 'Login page developed following prototype, backend API connected. Local server started, waiting for @Architect review.', tone: 'purple', tools: ['Bash', 'Read'], running: false, duration: '1m41s', tokens: '33.5K' },
  { avatar: 'A', name: 'Architect', date: 'May 31', time: '14:50', text: 'Code review passed, clean structure and standard APIs. Pushed to GitHub. @DevOps Please start deployment.', tone: 'blue', tools: ['Read'], running: false, duration: '34s', tokens: '9.8K' },
  { avatar: 'D', name: 'DevOps', date: 'May 31', time: '14:54', text: 'Source deployment complete, app URL: http://203.0.113.42:8080. @QA Please start automated verification.', tone: 'amber', tools: ['Bash'], running: false, duration: '3m18s', tokens: '21.4K' },
  { avatar: 'QA', name: 'QA', date: 'May 31', time: '15:00', text: 'Automated testing complete, all cases passed. Feature verification successful, Issue closed.', tone: 'teal', tools: ['Bash', 'Read'], running: false, duration: '1m53s', tokens: '28.9K' },
] as const

export function getDemoCards(lang: string) {
  return lang === 'zh' ? demoCardsZh : demoCardsEn
}

// ── 公共 SVG 组件 ──
export function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

export function WeChatIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.06 3C4.86 3 1.5 5.85 1.5 9.36c0 1.98 1.08 3.74 2.79 4.93.14.1.23.27.23.45 0 .06-.02.13-.04.19-.14.51-.36 1.32-.37 1.36-.02.06-.04.13-.04.2 0 .15.12.27.27.27.06 0 .11-.02.16-.05l1.76-1.02c.13-.08.28-.12.43-.12.08 0 .16.01.24.04.74.21 1.53.33 2.34.33.13 0 .26 0 .39-.01-.16-.5-.25-1.03-.25-1.58 0-3.13 3.04-5.66 6.79-5.66.13 0 .25 0 .38.01C16.43 4.83 12.99 3 9.06 3zM6.6 8.04c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm4.92 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z" />
      <path d="M22.5 14.58c0-2.93-2.8-5.31-6.25-5.31s-6.25 2.38-6.25 5.31 2.8 5.31 6.25 5.31c.69 0 1.36-.1 1.98-.28.07-.02.14-.03.21-.03.13 0 .25.03.36.1l1.47.85c.04.02.08.04.13.04.13 0 .23-.1.23-.23 0-.05-.02-.11-.03-.16-.01-.04-.2-.72-.31-1.13-.02-.05-.03-.1-.03-.16 0-.15.07-.28.19-.37 1.42-.99 2.32-2.45 2.32-4.07zm-8.27-.79c-.46 0-.83-.37-.83-.83s.37-.83.83-.83.83.37.83.83-.37.83-.83.83zm4.08 0c-.46 0-.83-.37-.83-.83s.37-.83.83-.83.83.37.83.83-.37.83-.83.83z" />
    </svg>
  )
}

export function iconSvg(kind: string) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (kind) {
    case 'chip':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...common}><rect width="16" height="16" x="4" y="4" rx="2" /><rect width="6" height="6" x="9" y="9" rx="1" /><path d="M15 2v2M9 2v2M2 9h2M2 15h2M22 9h-2M22 15h-2M15 22v-2M9 22v-2" /></svg>
    case 'bot':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...common}><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M12 11V4" /><path d="M8 11V7" /><path d="M16 11V7" /><circle cx="8.5" cy="16.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="15.5" cy="16.5" r="1.5" fill="currentColor" stroke="none" /></svg>
    case 'team':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
    case 'board':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...common}><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
    case 'cube':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...common}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
    default:
      return <svg width="22" height="22" viewBox="0 0 24 24" {...common}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
  }
}

export function openSourceIconSvg(kind: string) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (kind) {
    case 'free':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="10" /><path d="M9.5 9a3 3 0 0 1 5 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="2.5" strokeLinecap="round" /></svg>
    case 'opensource':
      return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" /></svg>
    default:
      return <svg width="22" height="22" viewBox="0 0 24 24" {...common}><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
  }
}

// ── 应用场景图标（替代 emoji） ──
export function scenarioIcon(kind: string): ReactNode {
  const common = { width: 34, height: 34, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (kind) {
    case 'dev': // 软件开发 — 代码尖括号
      return <svg {...common} stroke="#7B9FFF"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
    case 'bug': // Bug 修复 — 虫子
      return (
        <svg {...common} stroke="#FB923C">
          <rect x="8" y="6" width="8" height="12" rx="4" />
          <path d="M12 6V4M9.5 5l-1-1.5M14.5 5l1-1.5M8 10H4M8 14H4.5M16 10h4M16 14h3.5M8.5 18l-1.5 2M15.5 18l1.5 2" />
        </svg>
      )
    case 'pm': // 项目管理 — 看板
      return (
        <svg {...common} stroke="#5EEAD4">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16M3 4h18" />
          <path d="M6 9h0M12 9h0M18 9h0" strokeWidth="2.4" />
        </svg>
      )
    case 'ci': // 持续集成 — 循环箭头
      return (
        <svg {...common} stroke="#A78BFA">
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <polyline points="21 3 21 7 17 7" />
        </svg>
      )
    case 'content': // 内容创作 — 钢笔
      return (
        <svg {...common} stroke="#F472B6">
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z" />
          <path d="M2 2l7.6 7.6" />
          <circle cx="11" cy="11" r="2" />
        </svg>
      )
    case 'research': // 市场调研 — 放大镜
      return (
        <svg {...common} stroke="#5EEAD4">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      )
    case 'data': // 数据分析 — 柱状图
      return (
        <svg {...common} stroke="#34D399">
          <path d="M3 3v18h18" />
          <line x1="8" y1="17" x2="8" y2="12" />
          <line x1="13" y1="17" x2="13" y2="8" />
          <line x1="18" y1="17" x2="18" y2="5" />
        </svg>
      )
    case 'growth': // 运营增长 — 上升趋势
      return (
        <svg {...common} stroke="#FBBF24">
          <polyline points="3 17 9 11 13 15 21 7" />
          <polyline points="15 7 21 7 21 13" />
        </svg>
      )
    case 'doc': // 文档协作 — 文档
      return (
        <svg {...common} stroke="#7B9FFF">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="13" y2="17" />
        </svg>
      )
    default:
      return <svg {...common} stroke="currentColor"><circle cx="12" cy="12" r="9" /></svg>
  }
}

export function sectionIcon(kind: string): ReactNode {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.5 }
  switch (kind) {
    case 'features':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
    case 'workflow':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
    case 'showcase':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
    case 'opensource':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></svg>
    default:
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
  }
}

export function checkIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
}

export function downloadIcon(size = 16) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
}

export function toneToHue(tone: string) {
  if (tone === 'green') return '#2DD4BF'
  if (tone === 'purple') return '#A78BFA'
  if (tone === 'amber') return '#F59E0B'
  if (tone === 'teal') return '#14B8A6'
  if (tone === 'pink') return '#EC4899'
  if (tone === 'orange') return '#F97316'
  return '#4F7BFF'
}