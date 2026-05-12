import { useEffect, useRef, useState } from 'react'

// ── 下载配置（构建时通过环境变量注入，版本更新只需改环境变量） ──
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'v1.2.0'
const DOWNLOAD_URL_MAC = import.meta.env.VITE_DOWNLOAD_URL_MAC || '#'
const DOWNLOAD_URL_WIN = import.meta.env.VITE_DOWNLOAD_URL_WIN || '#'

const stripItems = [
  'Claude Sonnet',
  'DeepSeek Chat',
  'GPT-4o',
  'GLM-4',
  'Qwen Plus',
  'Codex',
  'Gemini Pro',
  'Hunyuan',
  'Spark',
  'Llama 3',
  'Claude Haiku',
  'Mistral',
  'Yi-34B',
  'Baichuan',
]

const features = [
  ['多模型统一接入', '支持 Anthropic、OpenAI、DeepSeek、智谱 AI、阿里云等 50+ 模型供应商，统一 API 格式管理。', '50+ 模型', 'blue'],
  ['智能 Agent 助手', '为每个 Agent 配置专属系统提示词、工具权限和执行策略，打造专业化 AI 团队成员。', '自定义能力', 'purple'],
  ['多 Agent 实时协作', '在群聊中召唤多个 Agent 同时工作，Team Leader 自动分配任务，成员并行执行、相互审查。', '并行执行', 'green'],
  ['任务看板追踪', '实时查看每个 Agent 的执行状态，待办、执行中、已完成、失败任务一览无余。', '实时状态', 'amber'],
  ['Skills 插件生态', '200+ 预置 Skills 涵盖代码审查、网页搜索、文档处理等场景，支持自定义扩展。', '200+ Skills', 'blue'],
  ['执行全链路日志', '树状结构展示每一步 Agent 思考过程、工具调用、输出结果，完整追踪任务执行链路。', '透明可溯', 'purple'],
] as const

const workflow = [
  ['01', '接入模型', '填入 API Key，即接入任意 AI 模型供应商，统一管理并发与权限。', 'blue'],
  ['02', '创建 Agent', '为 Agent 配置系统提示词、绑定模型与 Skills，定义其角色与能力边界。', 'purple'],
  ['03', '组建群聊', '创建项目群组，邀请多个 Agent 加入，指定 Team Leader 统筹协调。', 'green'],
  ['04', '下达任务', '发送一条消息，AI 团队自动拆解、分配、并行执行，实时汇报进展。', 'amber'],
] as const

const showcase = [
  'Agent 颜色系统：每个 Agent 有专属色，消息、卡片、状态全局一致，一眼识别执行者',
  '实时活动指示：执行中的 Agent 头像脉冲动画 + 思考点阵，感受 AI 在线工作',
  '工具调用透明：消息卡片内嵌工具调用标签，Read / Bash / Search 一目了然',
  '任务看板实时同步：已完成 / 执行中 / 失败任务按列分组，随时掌握整体进度',
]

const pricing = [
  ['基础版', '免费', '永久免费，无需信用卡', ['3 个 Agent 助手', '5 个群聊项目', '20 Skills', '社区支持'], '开始使用', false],
  ['专业版', '99', '每月 / 按年付享 8 折', ['无限 Agent 助手', '无限群聊项目', '200+ Skills 全量', '执行日志 30 天', '优先技术支持'], '立即订阅', true],
  ['团队版', '299', '每月 / 最多 10 席位', ['专业版全部功能', '团队共享 Agent', '权限与角色管理', '执行日志永久保存', '专属客户经理'], '联系销售', false],
] as const

const demoCards = [
  { avatar: 'T', name: 'Team Leader', time: '18:40', text: '已将任务拆分为 M1-M6，分配给各 Agent，请按序执行。', tone: 'blue', tools: [], running: false },
  { avatar: '科', name: '业务人员', time: '19:08', text: '收到 M1-M3，现在开始执行修改，读取关键文件...', tone: 'green', tools: ['Read', 'Bash'], running: true },
  { avatar: 'G', name: '高级开发', time: '19:07', text: '收到任务 M6，查看 sdk-runner.ts 兼容性...', tone: 'purple', tools: ['Read', 'Read'], running: true },
  { avatar: 'D', name: '前端开发', time: '18:56', text: '已完成 M4-M7 修复，共修改 12 个文件。', tone: 'amber', tools: [], running: false },
] as const

const agents = [
  { name: 'Team Leader', hue: 220 },
  { name: '产品经理', hue: 190 },
  { name: '业务人员', hue: 270 },
  { name: '前端开发', hue: 160 },
  { name: 'UI设计', hue: 35 },
  { name: '服务开发', hue: 330 },
  { name: '测试专家', hue: 50 },
]

const edges = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 5], [3, 6], [4, 5], [1, 6]]

function LogoMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M14 2L25 8.5V19.5L14 26L3 19.5V8.5L14 2Z" fill="#4F7BFF" fillOpacity=".15" stroke="#4F7BFF" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 12L14 15L19 12" stroke="#4F7BFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 15V21" stroke="#4F7BFF" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14" cy="9" r="2" fill="#4F7BFF" />
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

function sectionIcon(kind: string) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.5 }
  switch (kind) {
    case 'features':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
    case 'workflow':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
    case 'showcase':
      return <svg width="12" height="12" viewBox="0 0 24 24" {...common}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
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

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      document.body.classList.toggle('nav-scrolled', window.scrollY > 20)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const reveals = Array.from(document.querySelectorAll<HTMLElement>('.reveal'))
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12 })
    reveals.forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  }, [])

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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    let animationFrame = 0
    let lastSpawn = 0
    let nodes: Array<{ x: number; y: number; name: string; hue: number; r: number; pulse: number; pulseDir: number; active: boolean; initials: string }> = []
    let packets: Array<{ from: number; to: number; t: number; speed: number; hue: number }> = []

    const hslColor = (h: number, s = 70, l = 62, a = 1) => a < 1 ? `hsla(${h},${s}%,${l}%,${a})` : `hsl(${h},${s}%,${l}%)`

    const buildNodes = () => {
      const cx = width / 2
      const cy = height / 2
      const orbit = Math.min(width, height) * 0.34
      nodes = agents.map((agent, index) => {
        const angle = (index / agents.length) * Math.PI * 2 - Math.PI / 2
        const radius = index === 0 ? 0 : orbit
        return {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          name: agent.name,
          hue: agent.hue,
          r: index === 0 ? 22 : 16,
          pulse: 0,
          pulseDir: 1,
          active: index < 3,
          initials: agent.name.slice(0, 1),
        }
      })
    }

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      width = canvas.width = Math.max(320, Math.min(860, rect.width + 32))
      height = canvas.height = window.innerWidth <= 640 ? 320 : Math.max(440, Math.min(620, width * 0.72))
      buildNodes()
    }

    const spawnPacket = () => {
      const edge = edges[Math.floor(Math.random() * edges.length)]
      const reversed = Math.random() > 0.5
      const from = reversed ? edge[1] : edge[0]
      const to = reversed ? edge[0] : edge[1]
      packets.push({
        from,
        to,
        t: 0,
        speed: 0.004 + Math.random() * 0.004,
        hue: nodes[from]?.hue ?? 220,
      })
    }

    const draw = (ts: number) => {
      ctx.clearRect(0, 0, width, height)

      if (ts - lastSpawn > 600 + Math.random() * 400) {
        spawnPacket()
        lastSpawn = ts
      }

      edges.forEach(([a, b]) => {
        const na = nodes[a]
        const nb = nodes[b]
        if (!na || !nb) return
        ctx.beginPath()
        ctx.moveTo(na.x, na.y)
        ctx.lineTo(nb.x, nb.y)
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'
        ctx.lineWidth = 1
        ctx.stroke()
      })

      packets = packets.filter((packet) => packet.t <= 1)
      packets.forEach((packet) => {
        packet.t += packet.speed
        const from = nodes[packet.from]
        const to = nodes[packet.to]
        if (!from || !to) return
        const px = from.x + (to.x - from.x) * packet.t
        const py = from.y + (to.y - from.y) * packet.t
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, 6)
        gradient.addColorStop(0, hslColor(packet.hue, 80, 65, 0.9))
        gradient.addColorStop(1, hslColor(packet.hue, 80, 65, 0))
        ctx.beginPath()
        ctx.arc(px, py, 4, 0, Math.PI * 2)
        ctx.fillStyle = gradient
        ctx.fill()
      })

      nodes.forEach((node) => {
        if (node.active) {
          node.pulse += node.pulseDir * 0.012
          if (node.pulse > 1) { node.pulse = 1; node.pulseDir = -1 }
          if (node.pulse < 0) { node.pulse = 0; node.pulseDir = 1 }
          const ring = node.r + 6 + node.pulse * 5
          ctx.beginPath()
          ctx.arc(node.x, node.y, ring, 0, Math.PI * 2)
          ctx.strokeStyle = hslColor(node.hue, 70, 60, 0.2 + node.pulse * 0.15)
          ctx.lineWidth = 1.5
          ctx.stroke()
        }

        const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.r * 2.5)
        glow.addColorStop(0, hslColor(node.hue, 70, 55, 0.25))
        glow.addColorStop(1, hslColor(node.hue, 70, 55, 0))
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.r * 2.5, 0, Math.PI * 2)
        ctx.fillStyle = glow
        ctx.fill()

        ctx.beginPath()
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2)
        ctx.fillStyle = hslColor(node.hue, 60, 30, 0.9)
        ctx.fill()
        ctx.strokeStyle = hslColor(node.hue, 70, 60, 0.7)
        ctx.lineWidth = 1.5
        ctx.stroke()

        ctx.fillStyle = '#fff'
        ctx.font = `${node.r < 18 ? 11 : 13}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(node.initials, node.x, node.y)

        ctx.fillStyle = hslColor(node.hue, 50, 72, 0.9)
        ctx.font = '11px system-ui, sans-serif'
        ctx.fillText(node.name, node.x, node.y + node.r + 13)
      })

      animationFrame = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    animationFrame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className="page-shell">
      <div className="grid-bg" />

      <header className="top-nav">
        <a className="nav-logo" href="#top" aria-label="TeamAgentX Home">
          <LogoMark />
          <span>TeamAgentX</span>
        </a>
        <nav className="nav-links">
          <a href="#features">功能特性</a>
          <a href="#workflow">工作流程</a>
          <a href="#showcase">协作展示</a>
          <a href="#pricing">定价方案</a>
          <a href="#footer" className="nav-doc-link">文档</a>
        </nav>
        <div className="nav-actions">
          <a href="#download" className="btn btn-outline">登录</a>
          <a href="#download" className="btn btn-primary">{downloadIcon(13)} 下载应用</a>
          <button type="button" className="menu-toggle" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle menu">
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="mobile-menu">
          <a href="#features" onClick={() => setMenuOpen(false)}>功能特性</a>
          <a href="#workflow" onClick={() => setMenuOpen(false)}>工作流程</a>
          <a href="#showcase" onClick={() => setMenuOpen(false)}>协作展示</a>
          <a href="#pricing" onClick={() => setMenuOpen(false)}>定价方案</a>
          <a href="#download" onClick={() => setMenuOpen(false)}>下载应用</a>
        </div>
      )}

      <main id="top">
        <section className="hero">
          <div className="hero-content">
            <div className="eyebrow"><span />多 Agent 智能协作平台</div>
            <h1>让 AI 团队<br /><span>替你完成工作</span></h1>
            <p>配置模型、创建 Agent 助手、组建 AI 团队。<strong>多个 Agent 实时协作</strong>，自动分解任务、并行执行、相互审查，完成复杂项目。</p>
            <div className="hero-actions">
              <a href={DOWNLOAD_URL_MAC} className="btn btn-primary btn-hero">{downloadIcon(15)} 下载 macOS 客户端</a>
              <a href="#showcase" className="btn btn-outline btn-hero">查看演示</a>
            </div>
            <div className="hero-stats">
              <div><span data-count="50">0</span><small>支持 AI 模型</small></div>
              <div><span data-count="200">0</span><small>Skills 生态</small></div>
              <div><span data-count="10000">0</span><small>活跃用户</small></div>
            </div>
          </div>
          <div className="hero-canvas-wrap">
            <div className="hero-canvas-glow" />
            <canvas ref={canvasRef} id="hero-canvas" />
          </div>
        </section>

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

        <section id="features" className="section">
          <div className="section-inner">
            <div className="section-head reveal">
              <div className="section-label">{sectionIcon('features')}产品特性</div>
              <h2 className="section-title">一个平台，驱动整个 AI 团队</h2>
              <p className="section-sub">从模型接入到多 Agent 协作，TeamAgentX 提供完整的工作流，让复杂任务变得简单。</p>
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

        <section id="workflow" className="section section-tight">
          <div className="section-inner">
            <div className="section-head reveal">
              <div className="section-label">{sectionIcon('workflow')}工作流程</div>
              <h2 className="section-title">四步，让 AI 团队高效运转</h2>
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

        <section id="showcase" className="section section-tight">
          <div className="section-inner">
            <div className="section-head reveal">
              <div className="section-label">{sectionIcon('showcase')}多 Agent 协作</div>
              <h2 className="section-title">像管理团队一样管理 AI</h2>
              <p className="section-sub">每个 Agent 都有专属颜色标识，任务状态实时可见，协作过程清晰透明。</p>
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
                <a href="#download" className="btn btn-primary showcase-btn">立即下载体验</a>
              </div>
              <div className="showcase-visual">
                <div className="agent-cards-demo">
                  {demoCards.map((card) => (
                    <article key={`${card.name}-${card.time}`} className={`demo-card demo-border-accent ${card.running ? 'demo-running' : ''}`} style={{ borderLeftColor: toneToHue(card.tone) }}>
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

        <section id="pricing" className="section section-tight">
          <div className="section-inner">
            <div className="section-head reveal pricing-head">
              <div className="section-label">{sectionIcon('pricing')}定价方案</div>
              <h2 className="section-title">从个人到企业，按需选择</h2>
              <p className="section-sub">所有方案均包含核心 Agent 协作功能，随时可升级。</p>
            </div>
            <div className="pricing-grid reveal">
              {pricing.map(([plan, amount, period, items, cta, featured]) => (
                <article className={`price-card ${featured ? 'featured' : ''}`} key={plan}>
                  {featured && <div className="price-badge">推荐</div>}
                  <div className="price-plan">{plan}</div>
                  <div className="price-amount">{amount === '免费' ? '免费' : <><span>¥</span>{amount}</>}</div>
                  <div className="price-period">{period}</div>
                  <ul className="price-features">
                    {items.map((item) => (
                      <li key={item}>{checkIcon()}{item}</li>
                    ))}
                  </ul>
                  <a href="#download" className={`btn ${featured ? 'btn-primary' : 'btn-outline'} price-btn`}>{cta}</a>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <section id="download" className="cta-banner">
        <h2 className="cta-title reveal">准备好构建你的 AI 团队了吗？</h2>
        <p className="cta-sub reveal">下载 TeamAgentX，5 分钟内完成首个多 Agent 工作流。</p>
        <div className="cta-actions reveal">
          <a href={DOWNLOAD_URL_MAC} className="btn btn-primary btn-lg">{downloadIcon(16)}下载 macOS 客户端</a>
          <a href={DOWNLOAD_URL_WIN} className="btn btn-outline btn-lg">下载 Windows 客户端</a>
        </div>
        <p className="download-note reveal">当前版本 {APP_VERSION} · 支持 macOS 12+ / Windows 10+</p>
      </section>

      <footer id="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <div className="footer-logo"><LogoMark />TeamAgentX</div>
            <p className="footer-tagline">多 Agent 智能协作平台，让 AI 团队替你工作。</p>
          </div>
          <div className="footer-links">
            <div className="footer-col"><h4>产品</h4><a href="#features">功能特性</a><a href="#download">下载</a><a href="#pricing">定价</a><a href="#">路线图</a></div>
            <div className="footer-col"><h4>开发者</h4><a href="#">文档</a><a href="#">API 参考</a><a href="#">Skills 开发</a><a href="#">GitHub</a></div>
            <div className="footer-col"><h4>支持</h4><a href="#">帮助中心</a><a href="#">社区论坛</a><a href="#">联系我们</a><a href="#">反馈问题</a></div>
            <div className="footer-col"><h4>公司</h4><a href="#">关于我们</a><a href="#">博客</a><a href="#">隐私政策</a><a href="#">服务条款</a></div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 TeamAgentX. All rights reserved.</span>
          <span>Made with AI orchestration in mind</span>
        </div>
      </footer>
    </div>
  )
}

export default App
