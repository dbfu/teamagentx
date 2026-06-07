import { useEffect } from 'react'
import { getResolvedDownloadHref } from './download-helper'
import type { SiteConfig } from './site-config'
import { DownloadButton } from './download-button'
import { useLanguage } from './i18n/context'
import communityTemplates from './community-templates.json'

const GITHUB_URL = 'https://github.com/dbfu/teamagentx'

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
  updatedAt: string
  accent: TemplateAccent
}

// 头像栈最多展示的助手数量，超出部分以 +N 折叠
const MAX_VISIBLE_AGENTS = 5

const templates = communityTemplates as CommunityTemplate[]

function downloadIcon(size = 16) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
}

function checkIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
}

interface TemplatesPageProps {
  siteConfig?: SiteConfig
}

export function TemplatesPage({ siteConfig }: TemplatesPageProps) {
  const { t } = useLanguage()

  useEffect(() => {
    const reveals = Array.from(document.querySelectorAll<HTMLElement>('.reveal'))
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0, rootMargin: '0px 0px -10% 0px' })
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
          <a href="/showcase">{t('nav.showcase')}</a>
          <a href="/templates" className="active">{t('nav.templates')}</a>
          <a href="/docs">{t('nav.docs')}</a>
        </nav>
        <div className="nav-actions">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-github">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            GitHub
          </a>
          <DownloadButton siteConfig={siteConfig} variant="desktop" />
          <DownloadButton siteConfig={siteConfig} variant="mobile" />
        </div>
      </header>

      {/* ── 主内容 ── */}
      <main className="docs-layout" style={{ gridTemplateColumns: '280px minmax(0, 1fr)' }}>
        {/* 左侧栏 */}
        <aside className="docs-sidebar">
          <div className="docs-sidebar-card">
            <span className="docs-sidebar-label">{t('templates.sidebarLabel')}</span>
            <h1>{t('templates.sidebarTitle')}</h1>
            <p>{t('templates.sidebarDesc')}</p>
          </div>
          <div className="templates-summary-sidebar">
            <span className="templates-summary-num">{templates.length}</span>
            <small>{t('templates.summaryCount')}</small>
          </div>
          <div className="templates-import-tip">
            <strong>{t('templates.importTipTitle')}</strong>
            <ol>
              <li>{t('templates.importTip1')}</li>
              <li>{t('templates.importTip2')}</li>
              <li>{t('templates.importTip3')}</li>
            </ol>
          </div>
        </aside>

        {/* 右侧模板列表 */}
        <div className="docs-main">
          <section className="docs-hero templates-hero">
            <div className="docs-hero-badge">{t('templates.heroBadge')}</div>
            <h1>{t('templates.heroTitle')}</h1>
            <p>{t('templates.heroDesc')}</p>
          </section>

          <div className="templates-grid-full reveal">
            {templates.map((template) => {
              const visibleAgents = template.agents.slice(0, MAX_VISIBLE_AGENTS)
              const extraAgents = template.agents.length - visibleAgents.length
              return (
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
                    {visibleAgents.map((agent, index) => (
                      <span className={`template-agent tone-bg-${template.accent}`} key={`${template.id}-${agent}`}>
                        {index === 0 ? agent.slice(0, 1) : agent.slice(0, 2)}
                      </span>
                    ))}
                    {extraAgents > 0 && (
                      <span className={`template-agent template-agent-more tone-bg-${template.accent}`}>+{extraAgents}</span>
                    )}
                  </div>
                  <strong>
                    {visibleAgents.join(' / ')}
                    {extraAgents > 0 ? ` ${t('templates.agentsSuffix')} ${template.agents.length} ${t('templates.agentsCountSuffix')}` : ''}
                  </strong>
                </div>
                <div className="template-highlights">
                  {template.highlights.map((item) => (
                    <span key={`${template.id}-${item}`}>{checkIcon()}{item}</span>
                  ))}
                </div>
                <div className="template-meta">
                  <span>{template.agents.length} {t('templates.agentsCount')}</span>
                  <span>{template.size}</span>
                  <span>{template.updatedAt}</span>
                </div>
                <a
                  href={getResolvedDownloadHref(template.downloadUrl)}
                  rel="noopener noreferrer"
                  className="btn btn-outline template-download"
                >
                  {downloadIcon(14)}{t('templates.downloadBtn')}
                </a>
              </article>
              )
            })}
          </div>
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              <span>{t('footer.githubBadge')}</span>
            </a>
          </div>
          <div className="footer-links">
            <div className="footer-col">
              <h4>{t('footer.colProduct')}</h4>
              <a href="/#features">{t('footer.features')}</a>
              <a href="/#workflow">{t('footer.workflow')}</a>
              <a href="/#showcase">{t('footer.showcase')}</a>
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
              <a href="/docs#quickstart">{t('footer.firstRun')}</a>
              <a href="/docs#workspace">{t('footer.chatrooms')}</a>
              <a href="/docs#automation">{t('footer.cronTasks')}</a>
              <a href="/docs#settings">{t('footer.settings')}</a>
            </div>
            <div className="footer-col">
              <h4>{t('footer.colAbout')}</h4>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">{t('footer.license')}</a>
              <a href={`${GITHUB_URL}/releases`} target="_blank" rel="noopener noreferrer">{t('footer.changelog')}</a>
              <a href={`${GITHUB_URL}/issues/new`} target="_blank" rel="noopener noreferrer">{t('nav.contact')}</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 TeamAgentX. All rights reserved.</span>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="footer-oss-link">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            {t('footer.githubRepo')}
          </a>
        </div>
      </footer>
    </div>
  )
}