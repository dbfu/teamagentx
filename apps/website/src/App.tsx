import { useEffect, useState } from 'react'
import { DocsPage } from './docs-page'
import { getResolvedDownloadHref } from './download-helper'
import { useSiteConfig } from './site-config'
import communityTemplates from './community-templates.json'

const GITHUB_URL = 'https://github.com/dbfu/teamagentx'

// ── 模型滚动条 ──
const stripItems = [
  'Claude Sonnet', 'DeepSeek Chat', 'GPT-4o', 'GLM-4', 'Qwen Plus',
  'Codex', 'Gemini Pro', 'Hunyuan', 'Spark', 'Llama 3',
  'Claude Haiku', 'Mistral', 'Yi-34B', 'Baichuan',
]

// ── 功能特性 ──
const features = [
  ['多模型统一接入', '支持 Claude、GPT、DeepSeek、Qwen、GLM 等 50+ 主流模型，填入 API Key 即可接入，统一管理并发与权限。', '50+ 模型', 'blue'],
  ['专属 Agent 角色', '为每个助手定制系统提示词、工具权限和执行策略，打造具备专业能力的 AI 团队成员。', '角色定制', 'purple'],
  ['多 Agent 实时协作', '在群聊中 @ 任意 Agent，多个助手同时工作——调研、撰写、审核，自动接力完成复杂任务。', '并行执行', 'green'],
  ['任务队列 & 定时任务', '任务自动入队顺序执行，Cron 定时触发，中断后可恢复。Agent 在后台持续自动运转，无需人工守候。', '全自动化', 'amber'],
  ['长期房间记忆', '每个 Agent 在每个聊天室维护独立记忆，跨会话积累上下文，持续学习房间背景与偏好。', '持续学习', 'blue'],
  ['全链路透明追踪', '实时查看 Agent 思考过程、工具调用链路、执行状态和 Token 消耗，完整可溯每一步链路。', '透明可控', 'purple'],
] as const

// ── 工作流程 ──
const workflow = [
  ['01', '接入模型', '填入任意 AI 模型的 API Key，支持 Anthropic、OpenAI 协议及国内主流供应商，统一管理。', 'blue'],
  ['02', '创建 Agent', '为助手配置角色、提示词和工具权限，定义其专业领域和能力边界。', 'purple'],
  ['03', '组建聊天室', '创建群聊或快捷对话，邀请多个 Agent 加入，设定协作规则和工作目录。', 'green'],
  ['04', '下达任务', '发送一条消息，AI 团队自动拆解、分配、并行执行，实时汇报进展。', 'amber'],
] as const

// ── 协作演示列表 ──
const showcase = [
  '场景无限制：代码开发、内容创作、数据分析、竞品调研、文档整理——大模型能做的，Agent 都能自动化',
  '多 Agent 接力协作：一个负责调研，一个负责撰写，一个负责审核，流水线式自动完成复杂工作',
  '全程透明可控：实时查看每个 Agent 的思考过程和工具调用，随时干预或调整方向',
  '定时自动运行：配置 Cron 定时任务，让 Agent 定期生成报表、监控数据、推送摘要，7×24 小时运转',
]

// ── 开源免费卡片 ──
const openSourceItems = [
  { icon: 'free', title: '永久免费', desc: '所有功能完全免费使用，无功能限制，无试用期，无隐藏收费，当前阶段不设任何付费计划。', tag: '0 元', tone: 'green' },
  { icon: 'opensource', title: 'MIT 开源', desc: '完整源代码在 GitHub 公开，MIT 协议授权，可自由部署、二次开发和商业使用，欢迎 PR 贡献。', tag: 'MIT License', tone: 'blue' },
  { icon: 'selfhost', title: '私有化部署', desc: '本地 SQLite 数据库，数据完全存储在自己的设备上，也支持桌面端一键安装，无需服务器。', tag: '数据自主', tone: 'purple' },
] as const

type TemplateAccent = 'blue' | 'green' | 'purple' | 'amber'

interface CommunityTemplate {
  id: string
  name: string
  description: string
  scenario: string
  level: string
  agents: string[]
  highlights: string[]
  downloadUrl: string
  size: string
  downloads: number
  updatedAt: string
  accent: TemplateAccent
}

const templates = communityTemplates as CommunityTemplate[]

// ── showcase 静态卡片（用在协作展示区） ──
const demoCards = [
  { avatar: 'T', name: 'Team Leader', time: '14:20', text: '已将「Q3 竞品分析」拆分为 3 个子任务，分配给调研助手、撰写助手和审核助手，请依次执行。', tone: 'blue', tools: [], running: false },
  { avatar: '调', name: '调研助手', time: '14:21', text: '收到任务，正在搜索行业数据、分析竞品动态...', tone: 'green', tools: ['Search', 'Read'], running: true },
  { avatar: '撰', name: '撰写助手', time: '14:35', text: '已完成 3200 字分析报告，结构清晰，数据引用充分，待审核。', tone: 'purple', tools: [], running: false },
  { avatar: '审', name: '审核助手', time: '14:36', text: '正在审阅报告质量，检查数据准确性和逻辑完整性...', tone: 'amber', tools: ['Read'], running: true },
] as const

// ══════════════════════════════════════════════════════
//  Hero 动画：仿真聊天室 UI
// ══════════════════════════════════════════════════════
interface DemoMsg {
  id: number
  agent: string
  avatar: string
  tone: 'blue' | 'green' | 'purple' | 'amber'
  time: string
  text: string
  tools: string[]
}

const DEMO_MSGS: DemoMsg[] = [
  {
    id: 1, agent: 'Team Leader', avatar: 'T', tone: 'blue', time: '14:20',
    text: '已将「Q3 竞品分析」拆分为调研、撰写、审核 3 个子任务，分配给各助手，请按序执行。',
    tools: [],
  },
  {
    id: 2, agent: '调研助手', avatar: '调', tone: 'green', time: '14:22',
    text: '已完成行业数据搜索，整理了 12 家竞品的核心指标与近期动态，供撰写参考。',
    tools: ['Search', 'Read'],
  },
  {
    id: 3, agent: '撰写助手', avatar: '撰', tone: 'purple', time: '14:35',
    text: '基于调研数据，已完成 3200 字竞品分析报告，涵盖市场格局、功能对比和策略建议。',
    tools: ['Read'],
  },
  {
    id: 4, agent: '审核助手', avatar: '审', tone: 'amber', time: '14:37',
    text: '报告审核通过，数据引用准确，逻辑结构清晰，已标注 3 处可补充的数据点供优化。',
    tools: ['Read'],
  },
]

const SIDEBAR_ROOMS = [
  { icon: '📊', name: '竞品分析', active: true, unread: 4 },
  { icon: '💻', name: '产品开发', active: false, unread: 0 },
  { icon: '📝', name: '内容创作', active: false, unread: 0 },
  { icon: '📈', name: '数据报表', active: false, unread: 0 },
]

const SIDEBAR_AGENTS = [
  { avatar: 'T', name: 'Team Leader', tone: 'blue', online: true },
  { avatar: '调', name: '调研助手', tone: 'green', online: true },
  { avatar: '撰', name: '撰写助手', tone: 'purple', online: true },
  { avatar: '审', name: '审核助手', tone: 'amber', online: true },
]

// 动画状态机
function useHeroSequence() {
  const [visibleCount, setVisibleCount] = useState(1)
  const [typingIdx, setTypingIdx] = useState<number | null>(null)
  const [toolsIdx, setToolsIdx] = useState<number | null>(null)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    const s = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)) }

    const run = () => {
      setVisibleCount(1)
      setTypingIdx(null)
      setToolsIdx(null)

      // Msg 2 — 调研助手
      s(() => setTypingIdx(1), 1200)
      s(() => setToolsIdx(1), 2400)
      s(() => { setVisibleCount(2); setTypingIdx(null); setToolsIdx(null) }, 4200)

      // Msg 3 — 撰写助手
      s(() => setTypingIdx(2), 5200)
      s(() => setToolsIdx(2), 6400)
      s(() => { setVisibleCount(3); setTypingIdx(null); setToolsIdx(null) }, 8200)

      // Msg 4 — 审核助手
      s(() => setTypingIdx(3), 9200)
      s(() => setToolsIdx(3), 10400)
      s(() => { setVisibleCount(4); setTypingIdx(null); setToolsIdx(null) }, 12200)

      // 重新循环
      s(run, 16500)
    }

    run()
    return () => timers.forEach(clearTimeout)
  }, [])

  return { visibleCount, typingIdx, toolsIdx }
}

function HeroDemoWindow() {
  const { visibleCount, typingIdx, toolsIdx } = useHeroSequence()

  return (
    <div className="hero-visual">
      {/* 背景光晕 */}
      <div className="hero-visual-glow" />
      <div className="hero-visual-glow2" />

      {/* 窗口 + 角标整体容器（角标相对此定位） */}
      <div className="hero-win-wrap">
      {/* 主窗口 */}
      <div className="hero-win">
        {/* macOS 窗口栏 */}
        <div className="win-chrome">
          <div className="win-chrome-dots">
            <span className="wcd-close" />
            <span className="wcd-min" />
            <span className="wcd-max" />
          </div>
          <span className="win-chrome-title">TeamAgentX</span>
        </div>

        {/* 侧边栏 + 聊天区 */}
        <div className="win-body">
          {/* 侧边栏 */}
          <div className="win-sidebar">
            <div className="wsb-label">聊天室</div>
            {SIDEBAR_ROOMS.map((room) => (
              <div key={room.name} className={`wsb-room${room.active ? ' wsb-room-active' : ''}`}>
                <span className="wsb-room-icon">{room.icon}</span>
                <span className="wsb-room-name">{room.name}</span>
                {room.unread > 0 && <span className="wsb-badge">{room.unread}</span>}
              </div>
            ))}
            <div className="wsb-label wsb-label-mt">Agents</div>
            {SIDEBAR_AGENTS.map((a) => (
              <div key={a.name} className="wsb-agent">
                <span className={`wsb-agent-av tone-bg-${a.tone}`}>{a.avatar}</span>
                <span className="wsb-agent-name">{a.name}</span>
                {a.online && <span className="wsb-online-dot" />}
              </div>
            ))}
          </div>

          {/* 聊天主区 */}
          <div className="win-chat">
            {/* 聊天头部 */}
            <div className="wchat-hd">
              <span className="wchat-hd-icon">📊</span>
              <span className="wchat-hd-name">竞品分析</span>
              <div className="wchat-hd-members">
                {SIDEBAR_AGENTS.map((a) => (
                  <span key={a.name} className={`wchat-member tone-bg-${a.tone}`}>{a.avatar}</span>
                ))}
              </div>
            </div>

            {/* 消息列表 */}
            <div className="wchat-msgs">
              {DEMO_MSGS.slice(0, visibleCount).map((msg) => (
                <div key={msg.id} className="wchat-msg msg-in">
                  <div className={`wchat-av tone-bg-${msg.tone}`}>{msg.avatar}</div>
                  <div className="wchat-msg-body">
                    <div className="wchat-msg-meta">
                      <span className={`wchat-msg-name tone-text-${msg.tone}`}>{msg.agent}</span>
                      <span className="wchat-msg-time">{msg.time}</span>
                    </div>
                    {msg.tools.length > 0 && (
                      <div className="wchat-tools">
                        {msg.tools.map((t) => <span key={t} className="wchat-tool">{t}</span>)}
                      </div>
                    )}
                    <div className="wchat-msg-text">{msg.text}</div>
                  </div>
                </div>
              ))}

              {/* 打字 / 工具调用指示器 */}
              {typingIdx !== null && (
                <div className="wchat-msg msg-in" key={`typing-${typingIdx}-${toolsIdx}`}>
                  <div className={`wchat-av tone-bg-${DEMO_MSGS[typingIdx].tone}`}>
                    {DEMO_MSGS[typingIdx].avatar}
                  </div>
                  <div className="wchat-msg-body">
                    <div className="wchat-msg-meta">
                      <span className={`wchat-msg-name tone-text-${DEMO_MSGS[typingIdx].tone}`}>
                        {DEMO_MSGS[typingIdx].agent}
                      </span>
                      <span className="wchat-thinking-label">思考中…</span>
                    </div>
                    {toolsIdx === typingIdx ? (
                      <div className="wchat-tools wchat-tools-active">
                        {DEMO_MSGS[typingIdx].tools.map((t) => (
                          <span key={t} className="wchat-tool wchat-tool-live">{t}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="wchat-typing-dots">
                        <span /><span /><span />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 输入框 */}
            <div className="wchat-input">
              <span className="wchat-input-at">@</span>
              <span className="wchat-input-ph">提及 Agent，发送任务...</span>
              <span className="wchat-input-hint">⏎</span>
            </div>
          </div>
        </div>
      </div>

        {/* 浮动角标 — 右下 */}
        <div className="hbadge hbadge-br">
          <div className="hbadge-check-icon">✓</div>
          <div>
            <div className="hbadge-title">分析报告已完成</div>
            <div className="hbadge-sub">3200 字 · 刚刚生成</div>
          </div>
        </div>
      </div>{/* /hero-win-wrap */}
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  公共 SVG 组件
// ══════════════════════════════════════════════════════
function LogoMark() {
  return (
    <img src="/app-logo.png" alt="TeamAgentX" width={28} height={28} />
  )
}

function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

function iconSvg(kind: string) {
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

function openSourceIconSvg(kind: string) {
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

function sectionIcon(kind: string) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.5 }
  switch (kind) {
    case 'features':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
    case 'workflow':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
    case 'showcase':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
    case 'templates':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 17h7M17.5 13.5v7" /></svg>
    case 'opensource':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></svg>
    default:
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
  }
}

function checkIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
}

function downloadIcon(size = 16) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
}

function toneToHue(tone: string) {
  if (tone === 'green') return '#2DD4BF'
  if (tone === 'purple') return '#A78BFA'
  if (tone === 'amber') return '#F59E0B'
  return '#4F7BFF'
}

// ══════════════════════════════════════════════════════
//  主应用
// ══════════════════════════════════════════════════════
const IS_IOS = /iPhone|iPad/.test(navigator.userAgent)
const IS_ANDROID = /Android/.test(navigator.userAgent)
const IS_MOBILE = IS_IOS || IS_ANDROID
const IS_MAC = /Macintosh/.test(navigator.userAgent)

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showMacModal, setShowMacModal] = useState(false)
  const [selectedArch, setSelectedArch] = useState<'arm64' | 'x64'>('arm64')
  const [detectedArch, setDetectedArch] = useState<'arm64' | 'x64' | null>(null)
  const {
    version: APP_VERSION,
    macUrlArm64: DOWNLOAD_URL_MAC_ARM64,
    macUrlX64: DOWNLOAD_URL_MAC_X64,
    winUrl: DOWNLOAD_URL_WIN,
    iosUrl: DOWNLOAD_URL_IOS,
    androidUrl: DOWNLOAD_URL_ANDROID,
  } = useSiteConfig()
  const isDocsRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/docs')

  if (isDocsRoute) {
    return (
      <DocsPage
        siteConfig={{
          version: APP_VERSION,
          macUrlArm64: DOWNLOAD_URL_MAC_ARM64,
          macUrlX64: DOWNLOAD_URL_MAC_X64,
          winUrl: DOWNLOAD_URL_WIN,
          iosUrl: DOWNLOAD_URL_IOS,
          androidUrl: DOWNLOAD_URL_ANDROID,
        }}
      />
    )
  }

  // Apple Silicon vs Intel 架构检测
  useEffect(() => {
    if (!IS_MAC) return
    const uad = (navigator as { userAgentData?: { getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string }> } }).userAgentData
    const resolve = (arch: 'arm64' | 'x64') => { setDetectedArch(arch); setSelectedArch(arch) }
    if (uad?.getHighEntropyValues) {
      uad.getHighEntropyValues(['architecture'])
        .then((hints) => resolve(hints.architecture === 'arm' ? 'arm64' : 'x64'))
        .catch(() => resolve('arm64'))
    } else {
      resolve('arm64')
    }
  }, [])

  // 滚动导航样式
  useEffect(() => {
    const onScroll = () => { document.body.classList.toggle('nav-scrolled', window.scrollY > 20) }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Intersection Observer reveal
  useEffect(() => {
    const reveals = Array.from(document.querySelectorAll<HTMLElement>('.reveal'))
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add('in'); observer.unobserve(entry.target) }
      })
    }, { threshold: 0.12 })
    reveals.forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  }, [])

  // 数字计数动画
  useEffect(() => {
    const counters = Array.from(document.querySelectorAll<HTMLElement>('[data-count]'))
    const animateCounter = (el: HTMLElement, target: number) => {
      const suffix = target >= 1000 ? 'K+' : '+'
      const displayTarget = target >= 1000 ? target / 1000 : target
      let start = 0
      const duration = 1600
      const step = (ts: number) => {
        if (!start) start = ts
        const progress = Math.min((ts - start) / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        const current = Math.round(eased * displayTarget)
        el.textContent = `${current}${progress < 1 ? '' : suffix}`
        if (progress < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        animateCounter(entry.target as HTMLElement, Number((entry.target as HTMLElement).dataset.count))
        observer.unobserve(entry.target)
      })
    }, { threshold: 0.5 })
    counters.forEach((counter) => observer.observe(counter))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="page-shell">
      <div className="grid-bg" />

      {/* ── 顶部导航 ── */}
      <header className="top-nav">
        <a className="nav-logo" href="#top" aria-label="TeamAgentX Home">
          <LogoMark />
          <span>TeamAgentX</span>
        </a>
        <nav className="nav-links">
          <a href="#features">功能特性</a>
          <a href="#workflow">工作流程</a>
          <a href="#showcase">协作演示</a>
          <a href="#templates">群组模板</a>
          <a href="#opensource">开源免费</a>
          <a href="/docs">使用文档</a>
        </nav>
        <div className="nav-actions">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-github">
            <GitHubIcon size={15} />Star on GitHub
          </a>
          <a href="#download" className="btn btn-primary">{downloadIcon(13)} 下载应用</a>
          <button type="button" className="menu-toggle" onClick={() => setMenuOpen((o) => !o)} aria-label="Toggle menu">
            <span /><span /><span />
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="mobile-menu">
          <a href="#features" onClick={() => setMenuOpen(false)}>功能特性</a>
          <a href="#workflow" onClick={() => setMenuOpen(false)}>工作流程</a>
          <a href="#showcase" onClick={() => setMenuOpen(false)}>协作演示</a>
          <a href="#templates" onClick={() => setMenuOpen(false)}>群组模板</a>
          <a href="#opensource" onClick={() => setMenuOpen(false)}>开源免费</a>
          <a href="/docs" onClick={() => setMenuOpen(false)}>使用文档</a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>GitHub 开源</a>
          <a href="#download" onClick={() => setMenuOpen(false)}>下载应用</a>
        </div>
      )}

      <main id="top">
        {/* ── Hero ── */}
        <section className="hero">
          <div className="hero-content">
            <div className="eyebrow"><span />多模型 · 多 Agent · 开源免费</div>
            <h1>让 AI 团队<br /><span>替你处理一切</span></h1>
            <p>
              发一条消息，AI 团队立刻行动：<strong>调研助手</strong>收集数据、<strong>策划助手</strong>撰写方案、<strong>代码助手</strong>完成开发、<strong>审核助手</strong>把关质量。
              多个 Agent 并行推进、相互协作，竞品分析、内容创作、数据报告、软件开发——<strong>任何大模型能做的事，都能自动化完成。</strong>
            </p>
            <div className="hero-actions">
              <div className="hero-download-stack">
                {IS_IOS && DOWNLOAD_URL_IOS ? (
                  <a href={getResolvedDownloadHref(DOWNLOAD_URL_IOS)} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-hero">
                    {downloadIcon(15)} 下载 iOS App
                  </a>
                ) : IS_ANDROID && DOWNLOAD_URL_ANDROID ? (
                  <a href={getResolvedDownloadHref(DOWNLOAD_URL_ANDROID)} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-hero">
                    {downloadIcon(15)} 下载 Android App
                  </a>
                ) : IS_MAC ? (
                  <button type="button" className="btn btn-primary btn-hero" onClick={() => setShowMacModal(true)}>
                    {downloadIcon(15)} 下载 macOS 客户端
                  </button>
                ) : (
                  <a href={getResolvedDownloadHref(DOWNLOAD_URL_WIN)} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-hero">
                    {downloadIcon(15)} 下载 Windows 客户端
                  </a>
                )}
                <a href="#download" className="hero-more-download">
                  更多下载方式
                  <span aria-hidden="true">↓</span>
                </a>
              </div>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-hero">
                <GitHubIcon size={16} /> 开源 · 免费使用
              </a>
            </div>
            <div className="hero-stats">
              <div><span data-count="50">0</span><small>支持 AI 模型</small></div>
              <div><span className="stat-free">免费</span><small>永久免费使用</small></div>
              <div><span className="stat-oss">开源</span><small>MIT License</small></div>
            </div>
          </div>

          {/* 右侧：仿真聊天室动画 */}
          <HeroDemoWindow />
        </section>

        {/* ── 模型滚动条 ── */}
        <div className="strip">
          <div className="strip-inner">
            {[...stripItems, ...stripItems].map((item, index) => (
              <span className="strip-item" key={`${item}-${index}`}>
                <svg width="5" height="5" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="var(--accent)" opacity=".5" /></svg>
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* ── 功能特性 ── */}
        <section id="features" className="section">
          <div className="section-inner">
            <div className="section-head reveal">
              <div className="section-label">{sectionIcon('features')}产品特性</div>
              <h2 className="section-title">一个平台，驱动整个 AI 团队</h2>
              <p className="section-sub">
                从多模型接入到多 Agent 协作，TeamAgentX 提供完整的工作流，
                让复杂任务自动化——无论是技术工作还是业务场景。
              </p>
            </div>
            <div className="features-grid">
              {features.map(([title, desc, tag, tone], index) => {
                const kind = ['chip', 'bot', 'team', 'board', 'cube', 'terminal'][index] ?? 'terminal'
                return (
                  <article className={`feature-card reveal reveal-delay-${index % 3}`} key={title}>
                    <div className={`feature-icon tone-${tone}`}>{iconSvg(kind)}</div>
                    <h3 className="feature-title">{title}</h3>
                    <p className="feature-desc">{desc}</p>
                    <div className={`feature-tag tone-${tone}`}>{tag}</div>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── 工作流程 ── */}
        <section id="workflow" className="section section-tight">
          <div className="section-inner">
            <div className="section-head reveal">
              <div className="section-label">{sectionIcon('workflow')}工作流程</div>
              <h2 className="section-title">四步，让 AI 团队高效运转</h2>
              <p className="section-sub">无论什么任务场景，都能快速搭建属于你的 AI 协作团队。</p>
            </div>
            <div className="workflow-wrap reveal">
              <div className="workflow-steps">
                {workflow.map(([step, title, desc, tone]) => (
                  <article className="workflow-step" key={step}>
                    <div className={`step-num tone-${tone}`}>{step}</div>
                    <h3 className="step-title">{title}</h3>
                    <p className="step-desc">{desc}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 协作演示 ── */}
        <section id="showcase" className="section section-tight">
          <div className="section-inner">
            <div className="section-head reveal">
              <div className="section-label">{sectionIcon('showcase')}多 Agent 协作</div>
              <h2 className="section-title">不只是代码，任何事都能自动化</h2>
              <p className="section-sub">
                写文案、做调研、整理数据、生成报告——只要是大模型能做的事，
                交给 AI 团队协作都能完成。
              </p>
            </div>
            <div className="showcase reveal">
              <div className="showcase-info">
                <ul className="showcase-list">
                  {showcase.map((item) => (
                    <li key={item}>
                      <div className="check-icon">{checkIcon()}</div>
                      <div>{item}</div>
                    </li>
                  ))}
                </ul>
                <div className="showcase-actions">
                  <a href="#download" className="btn btn-primary showcase-btn">立即下载体验</a>
                  <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-outline showcase-btn">
                    <GitHubIcon size={14} />查看源码
                  </a>
                </div>
              </div>
              <div className="showcase-visual">
                <div className="agent-cards-demo">
                  {demoCards.map((card) => (
                    <article key={`${card.name}-${card.time}`} className={`demo-card ${card.running ? 'demo-running' : ''}`} style={{ borderLeftColor: toneToHue(card.tone) }}>
                      <div className={`demo-avatar tone-bg-${card.tone}`}>{card.avatar}</div>
                      <div className="demo-card-content">
                        <div className="demo-card-header">
                          <span className={`demo-card-name tone-text-${card.tone}`}>{card.name}</span>
                          <span className="demo-card-time">{card.time}</span>
                          {card.running && <div className="demo-dots"><span /><span /><span /></div>}
                        </div>
                        <div className="demo-card-text">{card.text}</div>
                        {card.tools.length > 0 && (
                          <div className="demo-tools">
                            {card.tools.map((tool, index) => <span className="demo-tool" key={`${card.name}-${tool}-${index}`}>{tool}</span>)}
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 社区群组模板 ── */}
        <section id="templates" className="section section-tight">
          <div className="section-inner templates-inner">
            <div className="templates-head reveal">
              <div>
                <div className="section-label">{sectionIcon('templates')}社区群组模板</div>
                <h2 className="section-title">把好用的 AI 群组直接带走</h2>
                <p className="section-sub">
                  桌面端导出的群组模板可以在这里集中展示和下载。每个模板都包含助手配置、群规则和协作方式，
                  导入后就能继续按自己的项目调整。
                </p>
              </div>
              <div className="templates-summary">
                <span>{templates.length}</span>
                <small>个精选模板</small>
              </div>
            </div>
            <div className="templates-grid reveal">
              {templates.map((template) => (
                <article className={`template-card template-card-${template.accent}`} key={template.id}>
                  <div className="template-card-top">
                    <div>
                      <div className={`template-scenario tone-${template.accent}`}>{template.scenario}</div>
                      <h3>{template.name}</h3>
                    </div>
                    <span className={`template-level tone-${template.accent}`}>{template.level}</span>
                  </div>
                  <p className="template-desc">{template.description}</p>
                  <div className="template-agents" aria-label={`${template.name} 助手列表`}>
                    <div className="template-agent-stack">
                      {template.agents.map((agent, index) => (
                        <span className={`template-agent tone-bg-${template.accent}`} key={`${template.id}-${agent}`}>
                          {index === 0 ? agent.slice(0, 1) : agent.slice(0, 2)}
                        </span>
                      ))}
                    </div>
                    <strong>{template.agents.join(' / ')}</strong>
                  </div>
                  <div className="template-highlights">
                    {template.highlights.map((item) => (
                      <span key={`${template.id}-${item}`}>{checkIcon()}{item}</span>
                    ))}
                  </div>
                  <div className="template-meta">
                    <span>{template.size}</span>
                    <span>{template.downloads.toLocaleString('zh-CN')} 次下载</span>
                    <span>{template.updatedAt}</span>
                  </div>
                  <a
                    href={getResolvedDownloadHref(template.downloadUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline template-download"
                  >
                    {downloadIcon(14)}下载模板
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── 开源免费 ── */}
        <section id="opensource" className="section section-tight">
          <div className="section-inner">
            <div className="section-head reveal oss-head">
              <div className="section-label">{sectionIcon('opensource')}开源免费</div>
              <h2 className="section-title">完全免费，永久开源</h2>
              <p className="section-sub oss-sub">
                TeamAgentX 是开源项目，MIT 协议授权。当前阶段所有功能免费使用，无任何付费计划。
              </p>
            </div>
            <div className="oss-grid reveal">
              {openSourceItems.map(({ icon, title, desc, tag, tone }) => (
                <article className={`oss-card oss-card-${tone}`} key={title}>
                  <div className={`feature-icon tone-${tone}`}>{openSourceIconSvg(icon)}</div>
                  <h3 className="feature-title">{title}</h3>
                  <p className="feature-desc">{desc}</p>
                  <div className={`feature-tag tone-${tone}`}>{tag}</div>
                </article>
              ))}
            </div>
            <div className="oss-github reveal">
              <div className="oss-github-info">
                <div className="oss-github-logo"><GitHubIcon size={28} /></div>
                <div>
                  <div className="oss-github-name">dbfu / teamagentx</div>
                  <div className="oss-github-desc">多模型多 Agent 协作平台 · MIT License · 欢迎 Star & PR</div>
                </div>
              </div>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-github-cta">
                <GitHubIcon size={16} />前往 GitHub 查看
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ── CTA Banner ── */}
      <section id="download" className="cta-banner">
        <h2 className="cta-title reveal">准备好组建你的 AI 团队了吗？</h2>
        <p className="cta-sub reveal">
          下载 TeamAgentX，5 分钟内完成首个多 Agent 工作流。<br />
          完全免费 · 开源无限制 · 数据本地存储
        </p>
        <div className="cta-actions reveal">
          <div className="download-platform-row">
            <span className="download-platform-label">桌面端</span>
            <button type="button" className={`btn btn-lg ${IS_MAC ? 'btn-primary' : 'btn-outline'}`} onClick={() => setShowMacModal(true)}>
              {downloadIcon(16)}下载 macOS 客户端
            </button>
            <a
              href={getResolvedDownloadHref(DOWNLOAD_URL_WIN)}
              target="_blank"
              rel="noopener noreferrer"
              className={`btn btn-lg ${!IS_MOBILE && !IS_MAC ? 'btn-primary' : 'btn-outline'}`}
            >
              下载 Windows 客户端
            </a>
          </div>
          <div className="download-platform-row">
            <span className="download-platform-label">移动端</span>
            {DOWNLOAD_URL_IOS ? (
              <a href={getResolvedDownloadHref(DOWNLOAD_URL_IOS)} target="_blank" rel="noopener noreferrer" className={`btn btn-lg ${IS_IOS ? 'btn-primary' : 'btn-outline'}`}>{downloadIcon(16)}下载 iOS App</a>
            ) : (
              <span className="mobile-store-btn mobile-store-soon">iOS 即将上线</span>
            )}
            {DOWNLOAD_URL_ANDROID ? (
              <a href={getResolvedDownloadHref(DOWNLOAD_URL_ANDROID)} target="_blank" rel="noopener noreferrer" className={`btn btn-lg ${IS_ANDROID ? 'btn-primary' : 'btn-outline'}`}>{downloadIcon(16)}下载 Android App</a>
            ) : (
              <span className="mobile-store-btn mobile-store-soon">Android 即将上线</span>
            )}
          </div>
        </div>
        <p className="download-note reveal">当前版本 {APP_VERSION} · 支持 macOS 12+ / Windows 10+ / iOS / Android · Apache 2.0 开源协议</p>
      </section>

      {/* ── macOS 芯片选择弹窗 ── */}
      {showMacModal && (
        <div className="mac-modal-overlay" onClick={() => setShowMacModal(false)}>
          <div className="mac-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mac-modal-close" onClick={() => setShowMacModal(false)}>×</button>
            <div className="mac-modal-header">
              <h3>选择 macOS 安装包</h3>
              <p>请根据你的 Mac 芯片类型选择对应版本</p>
            </div>
            <div className="mac-modal-options">
              <button
                type="button"
                className={`mac-modal-option${selectedArch === 'arm64' ? ' selected' : ''}`}
                onClick={() => setSelectedArch('arm64')}
              >
                <div className="mac-modal-option-body">
                  <div className="mac-modal-option-title">Apple Silicon</div>
                  <div className="mac-modal-option-desc">M1 · M2 · M3 · M4 及更新芯片</div>
                </div>
                {detectedArch === 'arm64' && <span className="mac-modal-badge">当前设备</span>}
              </button>
              <button
                type="button"
                className={`mac-modal-option${selectedArch === 'x64' ? ' selected' : ''}`}
                onClick={() => setSelectedArch('x64')}
              >
                <div className="mac-modal-option-body">
                  <div className="mac-modal-option-title">Intel</div>
                  <div className="mac-modal-option-desc">Intel Core 系列处理器</div>
                </div>
                {detectedArch === 'x64' && <span className="mac-modal-badge">当前设备</span>}
              </button>
            </div>
            <a
              href={getResolvedDownloadHref(selectedArch === 'arm64' ? DOWNLOAD_URL_MAC_ARM64 : DOWNLOAD_URL_MAC_X64)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary mac-modal-download-btn"
              onClick={() => {
                setShowMacModal(false)
              }}
            >
              {downloadIcon(15)} 下载 {selectedArch === 'arm64' ? 'Apple Silicon' : 'Intel'} 版本
            </a>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <footer id="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <div className="footer-logo"><LogoMark />TeamAgentX</div>
            <p className="footer-tagline">多模型 · 多 Agent 智能协作平台，让 AI 团队替你处理一切。</p>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="footer-github-badge">
              <GitHubIcon size={14} /><span>开源于 GitHub</span>
            </a>
          </div>
          <div className="footer-links">
            <div className="footer-col">
              <h4>产品</h4>
              <a href="#features">功能特性</a>
              <a href="#workflow">工作流程</a>
              <a href="#showcase">协作演示</a>
              <a href="#templates">群组模板</a>
              <a href="/docs">使用文档</a>
              <a href="#download">下载应用</a>
            </div>
            <div className="footer-col">
              <h4>开源</h4>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub 仓库</a>
              <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer">反馈问题</a>
              <a href={`${GITHUB_URL}/pulls`} target="_blank" rel="noopener noreferrer">贡献代码</a>
              <a href={`${GITHUB_URL}/releases`} target="_blank" rel="noopener noreferrer">版本发布</a>
            </div>
            <div className="footer-col">
              <h4>资源</h4>
              <a href="/docs#quickstart">快速开始</a>
              <a href="/docs#workspace">消息与工作区</a>
              <a href="/docs#automation">自动化与频道</a>
              <a href="/docs#settings">设置与多端连接</a>
            </div>
            <div className="footer-col">
              <h4>关于</h4>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">开源协议 (Apache 2.0)</a>
              <a href={`${GITHUB_URL}/releases`} target="_blank" rel="noopener noreferrer">更新日志</a>
              <a href={`${GITHUB_URL}/issues/new`} target="_blank" rel="noopener noreferrer">联系我们</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 TeamAgentX. All rights reserved.</span>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="footer-oss-link">
            <GitHubIcon size={12} />GitHub 仓库
          </a>
        </div>
      </footer>
    </div>
  )
}

export default App
