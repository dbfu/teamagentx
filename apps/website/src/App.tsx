import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DocsPage } from './docs-page'
import { TemplatesPage } from './templates-page'
import { FeaturesPage } from './features-page'
import { WorkflowPage } from './workflow-page'
import { ShowcasePage } from './showcase-page'
import { OpensourcePage } from './opensource-page'
import { Office3dPage } from './office3d-page'
import { GITHUB_URL, GitHubIcon, WeChatIcon, downloadIcon } from './shared-components'
import { getResolvedDownloadHref, trackBaiduDownload } from './download-helper'
import { DownloadButton } from './download-button'
import { useSiteConfig } from './site-config'
import { useLanguage } from './i18n/context'
import { LanguageSelect } from './components/language-select'

// ── 模型滚动条 ──
const stripItems = [
  'Claude Sonnet', 'DeepSeek Chat', 'GPT-4o', 'GLM-4', 'Qwen Plus',
  'Codex', 'Gemini Pro', 'Hunyuan', 'Spark', 'Llama 3',
  'Claude Haiku', 'Mistral', 'Yi-34B', 'Baichuan',
]

// ══════════════════════════════════════════════════════
//  Hero 动画：仿真聊天室 UI（仅首页使用）
// ══════════════════════════════════════════════════════
interface DemoMsg {
  id: number
  agent: string
  avatar: string
  tone: 'blue' | 'green' | 'purple' | 'amber' | 'orange' | 'pink' | 'teal'
  time: string
  text: string
  tools: string[]
}

// 中英文版本的演示消息
const DEMO_MSGS_ZH: DemoMsg[] = [
  { id: 1, agent: '产品经理', avatar: '产', tone: 'green', time: '14:20', text: '「用户登录功能」需求文档已完成：支持手机号/邮箱登录、记住密码、第三方登录，已创建开发 Issue。', tools: ['Write', 'Read'] },
  { id: 2, agent: '架构师', avatar: '架', tone: 'blue', time: '14:24', text: '架构设计完成，build 通过无报错，已将需求拆分为 UI、后端、前端、测试 4 个子任务并创建 Issue。', tools: ['Bash', 'Write'] },
  { id: 3, agent: 'UI设计', avatar: 'U', tone: 'pink', time: '14:30', text: '登录页 HTML 原型图已生成，自动打开浏览器预览，交互稿已同步给前端。', tools: ['Write'] },
  { id: 4, agent: '后端开发', avatar: '后', tone: 'orange', time: '14:38', text: '登录接口开发完成，本地服务正常启动，已提供联调文档，前端可对接。', tools: ['Bash', 'Read'] },
  { id: 5, agent: '前端开发', avatar: '前', tone: 'purple', time: '14:45', text: '已按原型图开发登录页并对接后端接口，本地服务正常启动，等待架构师 Review。', tools: ['Bash', 'Read'] },
  { id: 6, agent: '架构师', avatar: '架', tone: 'blue', time: '14:50', text: '代码 Review 通过，结构清晰、接口规范，已 push 到 GitHub，运维请开始部署。', tools: ['Read'] },
  { id: 7, agent: '运维', avatar: '运', tone: 'amber', time: '14:54', text: '源码方式部署完成，应用地址：http://203.0.113.42:8080，测试请开始自动化验证。', tools: ['Bash'] },
  { id: 8, agent: '测试', avatar: '测', tone: 'teal', time: '15:00', text: '自动化测试执行完成，用例全部通过，功能验证成功，Issue 已关闭。', tools: ['Bash', 'Read'] },
]

const DEMO_MSGS_EN: DemoMsg[] = [
  { id: 1, agent: 'PM', avatar: 'PM', tone: 'green', time: '14:20', text: 'User login feature requirement doc completed: supports phone/email login, remember password, third-party login. Dev Issue created.', tools: ['Write', 'Read'] },
  { id: 2, agent: 'Architect', avatar: 'A', tone: 'blue', time: '14:24', text: 'Architecture design complete, build passed with no errors. Requirement split into UI, Backend, Frontend, QA 4 subtasks, Issues created.', tools: ['Bash', 'Write'] },
  { id: 3, agent: 'UI Designer', avatar: 'U', tone: 'pink', time: '14:30', text: 'Login page HTML prototype generated, browser preview opened automatically. Interaction mock synced to frontend.', tools: ['Write'] },
  { id: 4, agent: 'Backend Dev', avatar: 'BE', tone: 'orange', time: '14:38', text: 'Login API development complete, local server started normally. Integration doc provided, frontend can connect.', tools: ['Bash', 'Read'] },
  { id: 5, agent: 'Frontend Dev', avatar: 'FE', tone: 'purple', time: '14:45', text: 'Login page developed following prototype, backend API connected. Local server started, waiting for Architect review.', tools: ['Bash', 'Read'] },
  { id: 6, agent: 'Architect', avatar: 'A', tone: 'blue', time: '14:50', text: 'Code review passed, clean structure and standard APIs. Pushed to GitHub, DevOps please start deployment.', tools: ['Read'] },
  { id: 7, agent: 'DevOps', avatar: 'D', tone: 'amber', time: '14:54', text: 'Source deployment complete, app URL: http://203.0.113.42:8080. QA please start automated verification.', tools: ['Bash'] },
  { id: 8, agent: 'QA', avatar: 'QA', tone: 'teal', time: '15:00', text: 'Automated testing complete, all cases passed. Feature verification successful, Issue closed.', tools: ['Bash', 'Read'] },
]

function getDemoMsgs(lang: string) {
  return lang === 'zh' ? DEMO_MSGS_ZH : DEMO_MSGS_EN
}

const SIDEBAR_ROOMS_ZH = [
  { icon: 'app', name: '开发记账应用', active: true, unread: 6 },
  { icon: 'xiaohongshu', name: '小红书自动发文', active: false, unread: 0 },
  { icon: 'chart', name: '销售数据分析', active: false, unread: 0 },
  { icon: 'plan', name: '制定运营方案', active: false, unread: 0 },
]

const SIDEBAR_ROOMS_EN = [
  { icon: 'app', name: 'Accounting App Dev', active: true, unread: 6 },
  { icon: 'xiaohongshu', name: 'Xiaohongshu Auto Post', active: false, unread: 0 },
  { icon: 'chart', name: 'Sales Analytics', active: false, unread: 0 },
  { icon: 'plan', name: 'Operations Planning', active: false, unread: 0 },
]

function getSidebarRooms(lang: string) {
  return lang === 'zh' ? SIDEBAR_ROOMS_ZH : SIDEBAR_ROOMS_EN
}

const SIDEBAR_AGENTS_ZH = [
  { avatar: '产', name: '产品经理', tone: 'green', online: true },
  { avatar: '架', name: '架构师', tone: 'blue', online: true },
  { avatar: 'U', name: 'UI设计', tone: 'pink', online: true },
  { avatar: '测', name: '测试', tone: 'teal', online: true },
  { avatar: '后', name: '后端开发', tone: 'orange', online: true },
  { avatar: '前', name: '前端开发', tone: 'purple', online: true },
  { avatar: '运', name: '运维', tone: 'amber', online: true },
]

const SIDEBAR_AGENTS_EN = [
  { avatar: 'PM', name: 'PM', tone: 'green', online: true },
  { avatar: 'A', name: 'Architect', tone: 'blue', online: true },
  { avatar: 'U', name: 'UI Designer', tone: 'pink', online: true },
  { avatar: 'QA', name: 'QA', tone: 'teal', online: true },
  { avatar: 'BE', name: 'Backend Dev', tone: 'orange', online: true },
  { avatar: 'FE', name: 'Frontend Dev', tone: 'purple', online: true },
  { avatar: 'D', name: 'DevOps', tone: 'amber', online: true },
]

function getSidebarAgents(lang: string) {
  return lang === 'zh' ? SIDEBAR_AGENTS_ZH : SIDEBAR_AGENTS_EN
}

// 统一的“应用图标”样式：圆角方块底色 + 白色简洁字形
function roomIconSvg(kind: string) {
  const ROOM_ICONS: Record<string, { from: string; to: string; glyph: ReactNode }> = {
    // 开发记账应用 — 蓝色，硬币 ¥
    app: {
      from: '#5B8DEF', to: '#3B6FE0',
      glyph: (
        <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <circle cx="12" cy="12" r="5.4" />
          <path d="M9.8 9.6 12 12.2l2.2-2.6M12 12.2V16M10.2 13.4h3.6" />
        </g>
      ),
    },
    // 小红书自动发文 — 红色，铅笔
    xiaohongshu: {
      from: '#FF5267', to: '#F31D3C',
      glyph: (
        <g fill="#fff">
          <path d="M14.9 7.4 16.6 9.1a.9.9 0 0 1 0 1.3l-5.9 5.9-2.7.6.6-2.7 5.9-5.9a.9.9 0 0 1 1.3 0Z" />
          <path d="m13.4 9 1.6 1.6" stroke="#F31D3C" strokeWidth="1" />
        </g>
      ),
    },
    // 销售数据分析 — 青色，柱状图
    chart: {
      from: '#2DD4BF', to: '#0EA5A0',
      glyph: (
        <g fill="#fff">
          <rect x="7" y="13" width="2.4" height="4" rx="0.8" />
          <rect x="10.8" y="10" width="2.4" height="7" rx="0.8" />
          <rect x="14.6" y="7.5" width="2.4" height="9.5" rx="0.8" />
        </g>
      ),
    },
    // 制定运营方案 — 橙色，靶心
    plan: {
      from: '#FB923C', to: '#F4711A',
      glyph: (
        <g fill="none" stroke="#fff" strokeWidth="1.5">
          <circle cx="12" cy="12" r="5.2" />
          <circle cx="12" cy="12" r="2" fill="#fff" stroke="none" />
        </g>
      ),
    },
  }

  const item = ROOM_ICONS[kind]
  if (!item) {
    return <svg width="18" height="18" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="6" fill="#94A3B8" /></svg>
  }
  const gid = `room-grad-${kind}`
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={item.from} />
          <stop offset="1" stopColor={item.to} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill={`url(#${gid})`} />
      {item.glyph}
    </svg>
  )
}

function LogoMark() {
  return (
    <img src="/app-logo.png" alt="TeamAgentX" width={28} height={28} />
  )
}

// 动画状态机 - 需要传入 DEMO_MSGS 数组
function useHeroSequence(demoMsgs: DemoMsg[]) {
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

      let t = 1200
      for (let i = 1; i < demoMsgs.length; i++) {
        const start = t
        s(() => setTypingIdx(i), start)
        s(() => setToolsIdx(i), start + 1200)
        s(() => { setVisibleCount(i + 1); setTypingIdx(null); setToolsIdx(null) }, start + 3000)
        t = start + 4000
      }

      s(run, t + 3000)
    }

    run()
    return () => timers.forEach(clearTimeout)
  }, [demoMsgs])

  return { visibleCount, typingIdx, toolsIdx }
}

function HeroDemoWindow() {
  const { lang } = useLanguage()
  const demoMsgs = getDemoMsgs(lang)
  const sidebarRooms = getSidebarRooms(lang)
  const sidebarAgents = getSidebarAgents(lang)
  const { visibleCount, typingIdx, toolsIdx } = useHeroSequence(demoMsgs)
  const msgsRef = useRef<HTMLDivElement>(null)

  // 消息变多后自动滚到底部
  useEffect(() => {
    const el = msgsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visibleCount, typingIdx, toolsIdx])

  return (
    <div className="hero-visual">
      {/* 背景光晕 */}
      <div className="hero-visual-glow" />
      <div className="hero-visual-glow2" />

      {/* 窗口 + 角标整体容器 */}
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
            <div className="wsb-label">{lang === 'zh' ? '聊天室' : 'Chatrooms'}</div>
            {sidebarRooms.map((room) => (
              <div key={room.name} className={`wsb-room${room.active ? ' wsb-room-active' : ''}`}>
                <span className="wsb-room-icon">{roomIconSvg(room.icon)}</span>
                <span className="wsb-room-name">{room.name}</span>
                {room.unread > 0 && <span className="wsb-badge">{room.unread}</span>}
              </div>
            ))}
            <div className="wsb-label wsb-label-mt">{lang === 'zh' ? '助手' : 'Agents'}</div>
            {sidebarAgents.map((a) => (
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
              <span className="wchat-hd-icon">{roomIconSvg('app')}</span>
              <span className="wchat-hd-name">{sidebarRooms[0].name}</span>
              <div className="wchat-hd-members">
                {sidebarAgents.map((a) => (
                  <span key={a.name} className={`wchat-member tone-bg-${a.tone}`}>{a.avatar}</span>
                ))}
              </div>
            </div>

            {/* 消息列表 */}
            <div className="wchat-msgs" ref={msgsRef}>
              {demoMsgs.slice(0, visibleCount).map((msg) => (
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
                  <div className={`wchat-av tone-bg-${demoMsgs[typingIdx].tone}`}>
                    {demoMsgs[typingIdx].avatar}
                  </div>
                  <div className="wchat-msg-body">
                    <div className="wchat-msg-meta">
                      <span className={`wchat-msg-name tone-text-${demoMsgs[typingIdx].tone}`}>
                        {demoMsgs[typingIdx].agent}
                      </span>
                      <span className="wchat-thinking-label">{lang === 'zh' ? '思考中…' : 'Thinking…'}</span>
                    </div>
                    {toolsIdx === typingIdx ? (
                      <div className="wchat-tools wchat-tools-active">
                        {demoMsgs[typingIdx].tools.map((t) => (
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
              <span className="wchat-input-ph">{lang === 'zh' ? '提及 Agent，发送任务...' : 'Mention Agent, send task...'}</span>
              <span className="wchat-input-hint">⏎</span>
            </div>
          </div>
        </div>
      </div>
      </div>{/* /hero-win-wrap */}
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  主应用
// ══════════════════════════════════════════════════════
const IS_ANDROID = /Android/.test(navigator.userAgent)
// 手机端不展示 3D 办公室（页面较重，体验不佳）
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showContactModal, setShowContactModal] = useState(false)
  const { lang, setLang, t } = useLanguage()
  const {
    version: APP_VERSION,
    macUrlArm64: DOWNLOAD_URL_MAC_ARM64,
    macUrlX64: DOWNLOAD_URL_MAC_X64,
    winUrl: DOWNLOAD_URL_WIN,
    iosUrl: DOWNLOAD_URL_IOS,
    androidUrl: DOWNLOAD_URL_ANDROID,
  } = useSiteConfig()

  // 路由判断
  const pathname = typeof window !== 'undefined' ? window.location.pathname : ''
  const isDocsRoute = pathname.startsWith('/docs')
  const isTemplatesRoute = pathname.startsWith('/templates')
  const isFeaturesRoute = pathname.startsWith('/features')
  const isWorkflowRoute = pathname.startsWith('/workflow')
  const isShowcaseRoute = pathname.startsWith('/showcase')
  const isOpensourceRoute = pathname.startsWith('/opensource')
  const isOfficeRoute = pathname.startsWith('/office')

  const siteConfig = {
    version: APP_VERSION,
    macUrlArm64: DOWNLOAD_URL_MAC_ARM64,
    macUrlX64: DOWNLOAD_URL_MAC_X64,
    winUrl: DOWNLOAD_URL_WIN,
    iosUrl: DOWNLOAD_URL_IOS,
    androidUrl: DOWNLOAD_URL_ANDROID,
  }

  // 滚动导航样式：随滚动距离渐变背景透明度（放在路由早返回之前，保证所有页面都生效）
  useEffect(() => {
    const onScroll = () => {
      const progress = Math.min(window.scrollY / 120, 1)
      document.body.style.setProperty('--nav-scroll', String(progress))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 路由处理
  if (isDocsRoute) return <DocsPage siteConfig={siteConfig} />
  if (isTemplatesRoute) return <TemplatesPage siteConfig={siteConfig} />
  if (isFeaturesRoute) return <FeaturesPage siteConfig={siteConfig} />
  if (isWorkflowRoute) return <WorkflowPage siteConfig={siteConfig} />
  if (isShowcaseRoute) return <ShowcasePage siteConfig={siteConfig} />
  if (isOpensourceRoute) return <OpensourcePage siteConfig={siteConfig} />
  // 手机端访问 /office 直接跳回首页，不展示 3D 办公室
  if (isOfficeRoute && IS_MOBILE) {
    if (typeof window !== 'undefined') window.location.replace('/')
    return null
  }
  if (isOfficeRoute) return <Office3dPage siteConfig={siteConfig} />

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

  // 预渲染完成信号
  useEffect(() => {
    if (typeof document !== 'undefined') {
      setTimeout(() => {
        document.dispatchEvent(new Event('render-complete'))
      }, 100)
    }
  }, [])

  return (
    <div className="page-shell">
      <div className="grid-bg" />

      {/* ── 顶部导航 ── */}
      <header className="top-nav">
        <a className="nav-logo" href="/" aria-label="TeamAgentX Home">
          <LogoMark />
          <span>TeamAgentX</span>
        </a>
        <nav className="nav-links">
          <a href="/" className="active">{t('nav.home')}</a>
          <a href="/office">{t('nav.office3d')}</a>
          <a href="/features">{t('nav.features')}</a>
          <a href="/workflow">{t('nav.workflow')}</a>
          <a href="/showcase">{t('nav.showcase')}</a>
          <a href="/templates">{t('nav.templates')}</a>
          <a href="/docs">{t('nav.docs')}</a>
        </nav>
        <div className="nav-actions">
          <LanguageSelect lang={lang} setLang={setLang} />
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-github">
            <GitHubIcon size={15} />{t('nav.github')}
          </a>
          <button type="button" className="btn btn-outline btn-contact" onClick={() => setShowContactModal(true)}>
            <WeChatIcon size={15} />{t('nav.contact')}
          </button>
          <DownloadButton siteConfig={siteConfig} variant="desktop" />
          <DownloadButton siteConfig={siteConfig} variant="mobile" />
          <button type="button" className="menu-toggle" onClick={() => setMenuOpen((o) => !o)} aria-label="Toggle menu">
            <span /><span /><span />
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="mobile-menu">
          <a href="/" onClick={() => setMenuOpen(false)}>{t('nav.home')}</a>
          {!IS_MOBILE && <a href="/office" onClick={() => setMenuOpen(false)}>{t('nav.office3d')}</a>}
          <a href="/features" onClick={() => setMenuOpen(false)}>{t('nav.features')}</a>
          <a href="/workflow" onClick={() => setMenuOpen(false)}>{t('nav.workflow')}</a>
          <a href="/showcase" onClick={() => setMenuOpen(false)}>{t('nav.showcase')}</a>
          <a href="/templates" onClick={() => setMenuOpen(false)}>{t('nav.templates')}</a>
          <a href="/docs" onClick={() => setMenuOpen(false)}>{t('nav.docs')}</a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>{t('nav.opensource')}</a>
          <a href="#" onClick={(e) => { e.preventDefault(); setMenuOpen(false); setShowContactModal(true) }}>{t('nav.contact')}</a>
          <a href="#download" onClick={() => setMenuOpen(false)}>{t('nav.download')}</a>
        </div>
      )}

      <main id="top">
        {/* ── Hero ── */}
        <section className="hero">
          <div className="hero-content">
            <div className="eyebrow"><span />{t('hero.eyebrow')}</div>
            <h1>{lang === 'zh' ? '让 AI 团队' : 'Let AI Team'}<br /><span>{t('hero.titleSpan')}</span></h1>
            <p>
              {lang === 'zh'
                ? <>
                  发一条消息，AI 团队立刻行动：<strong>产品经理</strong>梳理需求、<strong>架构师</strong>设计方案拆分任务、<strong>UI 设计</strong>输出原型、<strong>测试</strong>编写用例、<strong>前端/后端</strong>并行开发、<strong>运维</strong>自动部署。
                  多个 Agent 串行推进、并行协作，需求分析、架构设计、代码开发、自动化测试、部署发布——<strong>完整的软件开发流程，全自动完成。</strong>
                </>
                : <>
                  Send one message, AI team acts instantly: <strong>PM</strong> analyzes requirements, <strong>Architect</strong> designs and splits tasks, <strong>UI Designer</strong> creates prototypes, <strong>QA</strong> writes cases, <strong>Frontend/Backend</strong> developers code in parallel, <strong>DevOps</strong> deploys automatically.
                  Multi-Agent serial progression and parallel collaboration — <strong>complete software development lifecycle, fully automated.</strong>
                </>
              }
            </p>
            <div className="hero-actions">
              <div className="hero-download-stack">
                {IS_ANDROID && DOWNLOAD_URL_ANDROID ? (
                  <a
                    href={getResolvedDownloadHref(DOWNLOAD_URL_ANDROID, { platform: 'android' })}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary btn-hero"
                    onClick={() => trackBaiduDownload('android')}
                  >
                    {downloadIcon(15)} {lang === 'zh' ? '下载 Android App' : 'Download Android App'}
                  </a>
                ) : (
                  <DownloadButton siteConfig={siteConfig} variant="desktop" className="btn btn-primary btn-hero" iconSize={15} />
                )}
              </div>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-hero">
                <GitHubIcon size={16} /> {t('hero.btnOpenSource')}
              </a>
            </div>
            <div className="hero-stats">
              <div><span data-count="50">0</span><small>{t('hero.statsModels')}</small></div>
              <div><span className="stat-free">{t('hero.statsFreeLabel')}</span><small>{t('hero.statsFree')}</small></div>
              <div><span className="stat-oss">{t('hero.statsOssLabel')}</span><small>{t('hero.statsOss')}</small></div>
              <div><span className="stat-secure">{t('hero.statsSecureLabel')}</span><small>{t('hero.statsSecure')}</small></div>
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
      </main>

      {/* ── CTA Banner ── */}
      <section id="download" className="cta-banner">
        <h2 className="cta-title reveal">{t('cta.title')}</h2>
        <p className="cta-sub reveal">
          {lang === 'zh'
            ? <>
              下载 TeamAgentX，5 分钟内完成首个多 Agent 工作流。<br />
              完全免费 · 开源无限制 · 数据本地存储
            </>
            : <>
              Download TeamAgentX, complete your first multi-agent workflow in 5 minutes.<br />
              Free Forever · Open Source · Data Stored Locally
            </>
          }
        </p>
        <div className="cta-actions reveal">
          <div className="download-platform-row">
            <span className="download-platform-label">{t('cta.downloadDesktop')}</span>
            <DownloadButton siteConfig={siteConfig} variant="desktop" className="btn btn-lg btn-primary" iconSize={16} />
          </div>
          <div className="download-platform-row">
            <span className="download-platform-label">{t('cta.downloadMobile')}</span>
            <DownloadButton siteConfig={siteConfig} variant="mobile" className="btn btn-lg btn-outline" iconSize={16} />
          </div>
        </div>
        <p className="download-note reveal">{lang === 'zh'
          ? `当前版本 ${APP_VERSION} · 支持 macOS 12+ / Windows 10+ / Android · MIT 协议`
          : `Version ${APP_VERSION} · Supports macOS 12+ / Windows 10+ / Android · MIT License`
        }</p>
      </section>

      {/* ── 联系我（微信二维码）弹窗 ── */}
      {showContactModal && (
        <div className="mac-modal-overlay" onClick={() => setShowContactModal(false)}>
          <div className="contact-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mac-modal-close" onClick={() => setShowContactModal(false)}>×</button>
            <div className="mac-modal-header">
              <h3>{t('contact.title')}</h3>
              <p>{t('contact.subtitle')}</p>
            </div>
            <div className="contact-qr-wrap">
              <img src="/wechat-qr.png" alt={lang === 'zh' ? '微信二维码' : 'WeChat QR Code'} className="contact-qr-img" />
            </div>
            <p className="contact-qr-note">{lang === 'zh' ? <>添加时请备注 <strong>teamagentx</strong></> : <>Please mention <strong>teamagentx</strong> when adding</>}</p>
          </div>
        </div>
      )}


      {/* ── Footer ── */}
      <footer id="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <div className="footer-logo"><LogoMark />TeamAgentX</div>
            <p className="footer-tagline">{t('footer.tagline')}</p>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="footer-github-badge">
              <GitHubIcon size={14} /><span>{t('footer.githubBadge')}</span>
            </a>
          </div>
          <div className="footer-links">
            <div className="footer-col">
              <h4>{t('footer.colProduct')}</h4>
              <a href="/features">{t('footer.features')}</a>
              <a href="/workflow">{t('footer.workflow')}</a>
              <a href="/showcase">{t('footer.showcase')}</a>
              <a href="/templates">{t('footer.templates')}</a>
              <a href="/docs">{t('footer.docs')}</a>
              <a href="/#download">{t('footer.download')}</a>
            </div>
            <div className="footer-col">
              <h4>{t('footer.colOpenSource')}</h4>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">{t('footer.githubRepo')}</a>
              <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer">{t('footer.issues')}</a>
              <a href={`${GITHUB_URL}/pulls`} target="_blank" rel="noopener noreferrer">{t('footer.pulls')}</a>
              <a href={`${GITHUB_URL}/releases`} target="_blank" rel="noopener noreferrer">{t('footer.releases')}</a>
            </div>
            <div className="footer-col">
              <h4>{t('footer.colResources')}</h4>
              <a href="/docs/first-run">{t('footer.firstRun')}</a>
              <a href="/docs/chatrooms">{t('footer.chatrooms')}</a>
              <a href="/docs/cron-tasks">{t('footer.cronTasks')}</a>
              <a href="/docs/settings">{t('footer.settings')}</a>
            </div>
            <div className="footer-col">
              <h4>{t('footer.colAbout')}</h4>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">{t('footer.license')}</a>
              <a href={`${GITHUB_URL}/releases`} target="_blank" rel="noopener noreferrer">{t('footer.changelog')}</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 TeamAgentX. All rights reserved.</span>
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="footer-icp-link">
            皖ICP备2023008637号-2
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="footer-oss-link">
            <GitHubIcon size={12} />GitHub 仓库
          </a>
        </div>
      </footer>
    </div>
  )
}

export default App