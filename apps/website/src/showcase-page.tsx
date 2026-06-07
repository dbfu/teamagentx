import { useEffect, useRef, useState } from 'react'
import {
  GITHUB_URL,
  getDemoCards,
  GitHubIcon,
  sectionIcon,
  scenarioIcon,
} from './shared-components'
import type { SiteConfig } from './site-config'
import { DownloadButton } from './download-button'
import { useLanguage } from './i18n/context'
import { LanguageSelect } from './components/language-select'

// 把文本里的 @提及 渲染成蓝色高亮
function renderMessageText(text: string) {
  const parts = text.split(/(@[一-龥A-Za-z0-9]+)/g)
  return parts.map((part, i) =>
    part.startsWith('@')
      ? <span key={i} className="chatwin-mention">{part}</span>
      : <span key={i}>{part}</span>,
  )
}

// 群聊消息逐条出现的动画状态机
function useChatSequence(demoCards: readonly { avatar: string; name: string; date: string; time: string; text: string; tone: string; tools: readonly string[]; running: boolean; duration: string; tokens: string }[]) {
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

      let t = 1400
      for (let i = 1; i < demoCards.length; i++) {
        const start = t
        s(() => setTypingIdx(i), start)
        s(() => setToolsIdx(i), start + 1100)
        s(() => { setVisibleCount(i + 1); setTypingIdx(null); setToolsIdx(null) }, start + 2800)
        t = start + 3800
      }
      s(run, t + 3500)
    }

    run()
    return () => timers.forEach(clearTimeout)
  }, [demoCards])

  return { visibleCount, typingIdx, toolsIdx }
}

interface ShowcasePageProps {
  siteConfig?: SiteConfig
}

export function ShowcasePage({ siteConfig }: ShowcasePageProps) {
  const { lang, setLang, t } = useLanguage()
  const demoCards = getDemoCards(lang)
  const { visibleCount, typingIdx, toolsIdx } = useChatSequence(demoCards)
  const msgsRef = useRef<HTMLDivElement>(null)

  // 新消息出现时自动滚到底部
  useEffect(() => {
    const el = msgsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visibleCount, typingIdx, toolsIdx])

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

  // 预渲染完成信号
  useEffect(() => {
    if (typeof document !== 'undefined') {
      setTimeout(() => {
        document.dispatchEvent(new Event('render-complete'))
      }, 100)
    }
  }, [])

  // 群聊成员（根据语言显示）
  const showcaseMembers = lang === 'zh'
    ? [
      { avatar: '产', name: '产品经理', tone: 'green' },
      { avatar: '架', name: '架构师', tone: 'blue' },
      { avatar: 'U', name: 'UI设计', tone: 'pink' },
      { avatar: '后', name: '后端开发', tone: 'orange' },
      { avatar: '前', name: '前端开发', tone: 'purple' },
      { avatar: '运', name: '运维', tone: 'amber' },
      { avatar: '测', name: '测试', tone: 'teal' },
    ]
    : [
      { avatar: 'PM', name: 'PM', tone: 'green' },
      { avatar: 'A', name: 'Architect', tone: 'blue' },
      { avatar: 'U', name: 'UI', tone: 'pink' },
      { avatar: 'BE', name: 'Backend', tone: 'orange' },
      { avatar: 'FE', name: 'Frontend', tone: 'purple' },
      { avatar: 'D', name: 'DevOps', tone: 'amber' },
      { avatar: 'QA', name: 'QA', tone: 'teal' },
    ]

  return (
    <div className="page-shell docs-shell">
      <div className="grid-bg" />

      {/* ── 顶部导航 ── */}
      <header className="top-nav docs-top-nav">
        <a className="nav-logo" href="/" aria-label="TeamAgentX Home">
          <img src="/app-logo.png" alt="TeamAgentX" width={28} height={28} />
          <span>TeamAgentX</span>
        </a>
        <nav className="nav-links docs-nav-links">
          <a href="/">{t('nav.home')}</a>
          <a href="/office">{t('nav.office3d')}</a>
          <a href="/features">{t('nav.features')}</a>
          <a href="/workflow">{t('nav.workflow')}</a>
          <a href="/showcase" className="active">{t('nav.showcase')}</a>
          <a href="/templates">{t('nav.templates')}</a>
          <a href="/docs">{t('nav.docs')}</a>
        </nav>
        <div className="nav-actions">
          <LanguageSelect lang={lang} setLang={setLang} />
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-github">
            <GitHubIcon size={15} />{t('nav.github')}
          </a>
          <DownloadButton siteConfig={siteConfig} variant="desktop" />
          <DownloadButton siteConfig={siteConfig} variant="mobile" />
        </div>
      </header>

      {/* ── 主内容 ── */}
      <main className="docs-layout" style={{ gridTemplateColumns: '1fr' }}>
        <div className="docs-main" style={{ maxWidth: '100%' }}>
          {/* Hero */}
          <section className="docs-hero showcase-hero">
            <div className="docs-hero-badge">{sectionIcon('showcase')}{lang === 'zh' ? '多 Agent 协作' : 'Multi-Agent Collaboration'}</div>
            <h1>{lang === 'zh' ? '不只是代码，任何事都能自动化' : 'Not Just Code, Automate Everything'}</h1>
            <p>{lang === 'zh' ? '写文案、做调研、整理数据、生成报告，大模型能做的事都能交给 AI 团队协作完成。' : 'Write copy, research, organize data, generate reports—anything LLMs can do can be handled by AI team collaboration.'}</p>
          </section>

          {/* 协作演示 */}
          <div className="showcase-stack reveal">
            <div className="showcase-info-top">
              <h2>{lang === 'zh' ? '实际协作场景演示' : 'Live Collaboration Demo'}</h2>
            </div>

            {/* 仿真群聊窗口 */}
            <div className="chatwin">
              <div className="chatwin-hd">
                <span className="chatwin-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="2" y="2" width="20" height="20" rx="6" fill="#4F7BFF" />
                    <path d="M9.5 9 7 12l2.5 3M14.5 9 17 12l-2.5 3" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="chatwin-hd-info">
                  <span className="chatwin-title">{lang === 'zh' ? '用户登录功能开发' : 'User Login Feature Dev'}</span>
                  <span className="chatwin-sub">{lang === 'zh' ? '7 位助手协作中' : '7 Agents Collaborating'}</span>
                </div>
                <div className="chatwin-members">
                  {showcaseMembers.map((m) => (
                    <span key={m.name} className={`chatwin-member tone-bg-${m.tone}`} title={m.name}>{m.avatar}</span>
                  ))}
                </div>
              </div>
              <div className="chatwin-msgs" ref={msgsRef}>
                {demoCards.slice(0, visibleCount).map((card) => (
                  <div key={`${card.name}-${card.time}`} className="chatwin-msg chatwin-msg-in">
                    <div className={`chatwin-av tone-bg-${card.tone}`}>{card.avatar}</div>
                    <div className="chatwin-msg-body">
                      <div className="chatwin-msg-meta">
                        <span className="chatwin-msg-name">{card.name}</span>
                        <span className="chatwin-msg-copy" aria-hidden="true">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                        </span>
                        <span className="chatwin-msg-time">{card.date} {card.time}</span>
                      </div>
                      <div className="chatwin-content">
                        {card.tools.length > 0 && (
                          <div className="chatwin-tools">
                            {card.tools.map((tool: string, index: number) => (
                              <span className="chatwin-tool" key={`${card.name}-${tool}-${index}`}>{tool}</span>
                            ))}
                          </div>
                        )}
                        <div className="chatwin-text">{renderMessageText(card.text)}</div>
                        {card.duration && (
                          <div className="chatwin-foot">
                            <span className="chatwin-foot-detail">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" /></svg>
                              {lang === 'zh' ? '查看执行详情' : 'View Details'}
                            </span>
                            <span className="chatwin-foot-stat">{lang === 'zh' ? '耗时' : 'Duration'}：{card.duration}</span>
                            <span className="chatwin-foot-stat">Token：{card.tokens}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* 思考中 */}
                {typingIdx !== null && (
                  <div className="chatwin-msg chatwin-msg-in" key={`typing-${typingIdx}-${toolsIdx}`}>
                    <div className={`chatwin-av tone-bg-${demoCards[typingIdx].tone}`}>{demoCards[typingIdx].avatar}</div>
                    <div className="chatwin-msg-body">
                      <div className="chatwin-msg-meta">
                        <span className="chatwin-msg-name">{demoCards[typingIdx].name}</span>
                        <span className="chatwin-thinking">{lang === 'zh' ? '思考中' : 'Thinking'}<span className="demo-dots"><span /><span /><span /></span></span>
                      </div>
                      <div className="chatwin-content">
                        {toolsIdx === typingIdx && demoCards[typingIdx].tools.length > 0 ? (
                          <div className="chatwin-tools">
                            {demoCards[typingIdx].tools.map((tool: string, index: number) => (
                              <span className="chatwin-tool chatwin-tool-live" key={`typing-${tool}-${index}`}>{tool}</span>
                            ))}
                          </div>
                        ) : (
                          <div className="chatwin-typing-dots"><span /><span /><span /></div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="chatwin-input">
                <span className="chatwin-input-at">@</span>
                <span className="chatwin-input-ph">{lang === 'zh' ? '提及助手，发送任务…' : 'Mention Agent, send task…'}</span>
                <span className="chatwin-input-send">⏎</span>
              </div>
            </div>
          </div>

          {/* 应用场景 */}
          <section className="showcase-scenarios reveal">
            <h2>{lang === 'zh' ? '适用场景' : 'Use Cases'}</h2>
            <div className="scenarios-grid">
              <div className="scenario-card">
                <div className="scenario-icon">{scenarioIcon('dev')}</div>
                <h4>{lang === 'zh' ? '软件开发' : 'Software Dev'}</h4>
                <p>{lang === 'zh' ? '需求分析、架构设计、前后端开发、自动化测试、部署发布——完整开发流程全自动。' : 'Requirement analysis, architecture design, frontend/backend dev, automated testing, deployment—complete dev lifecycle automated.'}</p>
              </div>
              <div className="scenario-card">
                <div className="scenario-icon">{scenarioIcon('content')}</div>
                <h4>{lang === 'zh' ? '内容创作' : 'Content Creation'}</h4>
                <p>{lang === 'zh' ? '公众号文章、营销文案、脚本策划——多个 Agent 分工撰写、润色、配图，一键多平台分发。' : 'Articles, marketing copy, script planning—multiple Agents write, edit, illustrate, multi-platform distribution.'}</p>
              </div>
              <div className="scenario-card">
                <div className="scenario-icon">{scenarioIcon('research')}</div>
                <h4>{lang === 'zh' ? '市场调研' : 'Market Research'}</h4>
                <p>{lang === 'zh' ? '竞品分析、行业研究、用户访谈整理——Agent 搜集资料、交叉验证，输出结构化调研报告。' : 'Competitor analysis, industry research, interview notes—Agents gather data, cross-verify, output structured reports.'}</p>
              </div>
              <div className="scenario-card">
                <div className="scenario-icon">{scenarioIcon('data')}</div>
                <h4>{lang === 'zh' ? '数据分析' : 'Data Analysis'}</h4>
                <p>{lang === 'zh' ? '清洗整理数据、生成图表、撰写结论——从原始表格到可视化报表，自动出分析报告。' : 'Clean data, generate charts, write conclusions—from raw tables to visual reports, automated analysis.'}</p>
              </div>
              <div className="scenario-card">
                <div className="scenario-icon">{scenarioIcon('growth')}</div>
                <h4>{lang === 'zh' ? '运营增长' : 'Growth Ops'}</h4>
                <p>{lang === 'zh' ? '活动策划、社媒排期、运营日报——Agent 协作产出方案并跟踪数据，持续优化增长动作。' : 'Event planning, social media scheduling, daily reports—Agents produce plans and track data, optimize growth.'}</p>
              </div>
              <div className="scenario-card">
                <div className="scenario-icon">{scenarioIcon('doc')}</div>
                <h4>{lang === 'zh' ? '文档协作' : 'Doc Collaboration'}</h4>
                <p>{lang === 'zh' ? '资料整理、长文翻译、会议纪要、知识库维护——把零散信息沉淀成规范文档。' : 'Material organization, translation, meeting notes, knowledge base—turn scattered info into structured docs.'}</p>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer id="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <div className="footer-logo">
              <img src="/app-logo.png" alt="TeamAgentX" width={28} height={28} />
              TeamAgentX
            </div>
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
              <a href="/docs#quickstart">{lang === 'zh' ? '快速开始' : 'Quick Start'}</a>
              <a href="/docs#workspace">{lang === 'zh' ? '消息与工作区' : 'Messages'}</a>
              <a href="/docs#automation">{lang === 'zh' ? '自动化' : 'Automation'}</a>
              <a href="/docs#settings">{lang === 'zh' ? '系统设置' : 'Settings'}</a>
            </div>
            <div className="footer-col">
              <h4>{t('footer.colAbout')}</h4>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">{t('footer.license')}</a>
              <a href={`${GITHUB_URL}/releases`} target="_blank" rel="noopener noreferrer">{t('footer.changelog')}</a>
              <a href={`${GITHUB_URL}/issues/new`} target="_blank" rel="noopener noreferrer">{lang === 'zh' ? '联系我们' : 'Contact'}</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 TeamAgentX. All rights reserved.</span>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="footer-oss-link">
            <GitHubIcon size={12} />{t('footer.githubRepo')}
          </a>
        </div>
      </footer>
    </div>
  )
}