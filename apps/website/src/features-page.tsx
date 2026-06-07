import { useEffect } from 'react'
import {
  GITHUB_URL,
  getFeatures,
  GitHubIcon,
  iconSvg,
  sectionIcon,
} from './shared-components'
import type { SiteConfig } from './site-config'
import { DownloadButton } from './download-button'
import { useLanguage } from './i18n/context'
import { LanguageSelect } from './components/language-select'

interface FeaturesPageProps {
  siteConfig?: SiteConfig
}

export function FeaturesPage({ siteConfig }: FeaturesPageProps) {
  const { lang, setLang, t } = useLanguage()
  const features = getFeatures(lang)

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
          <a href="/features" className="active">{t('nav.features')}</a>
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
          <DownloadButton siteConfig={siteConfig} variant="desktop" />
          <DownloadButton siteConfig={siteConfig} variant="mobile" />
        </div>
      </header>

      {/* ── 主内容 ── */}
      <main className="docs-layout" style={{ gridTemplateColumns: '1fr' }}>
        <div className="docs-main" style={{ maxWidth: '100%' }}>
          {/* Hero */}
          <section className="docs-hero features-hero">
            <div className="docs-hero-badge">{sectionIcon('features')}{lang === 'zh' ? '产品特性' : 'Product Features'}</div>
            <h1>{lang === 'zh' ? '一个平台，驱动整个 AI 团队' : 'One Platform, Drive the Entire AI Team'}</h1>
            <p>
              {lang === 'zh'
                ? '从多模型接入到多 Agent 协作，TeamAgentX 提供完整的工作流，让复杂任务自动化——无论是技术工作还是业务场景。'
                : 'From multi-model integration to multi-agent collaboration, TeamAgentX provides complete workflow, automating complex tasks—technical or business scenarios.'
              }
            </p>
          </section>

          {/* 功能卡片 */}
          <div className="features-grid-full reveal">
            {features.map(([title, desc, tag, tone], index) => {
              const kind = ['chip', 'bot', 'team', 'board', 'cube', 'terminal'][index] ?? 'terminal'
              return (
                <article className={`feature-card feature-card-full feature-card-${tone}`} key={title}>
                  <div className={`feature-icon tone-${tone}`}>{iconSvg(kind)}</div>
                  <h3 className="feature-title">{title}</h3>
                  <p className="feature-desc">{desc}</p>
                  <div className={`feature-tag tone-${tone}`}>{tag}</div>
                </article>
              )
            })}
          </div>

          {/* ── 技术说明 ── */}
          <section className="tech-note reveal">
            <div className="tech-note-inner">
              <h3>{lang === 'zh' ? '底层 Agent 能力' : 'Underlying Agent Capabilities'}</h3>
              <p>
                {lang === 'zh'
                  ? <>
                    TeamAgentX 本身不开发 Agent，而是作为<strong>Agent 调度与协作平台</strong>。
                    我们调度的是业界顶尖的 Agent 能力——底层使用
                    <span className="tech-model">Claude Code</span> 和
                    <span className="tech-model">Codex</span>
                    构建，这些都是当前最强大的 AI Agent，你完全不用担心 Agent 能力问题。
                  </>
                  : <>
                    TeamAgentX does not develop Agents itself, but serves as an <strong>Agent Orchestration & Collaboration Platform</strong>.
                    We orchestrate industry-leading Agent capabilities—built on
                    <span className="tech-model">Claude Code</span> and
                    <span className="tech-model">Codex</span>,
                    the most powerful AI Agents available today. You don't need to worry about Agent capabilities.
                  </>
                }
              </p>
              <div className="tech-note-sub">
                {lang === 'zh'
                  ? '我们专注于多 Agent 协作编排、任务调度、记忆管理——让 AI 团队高效运转，是我们的核心价值。'
                  : 'We focus on multi-agent orchestration, task scheduling, memory management—making AI teams run efficiently is our core value.'
                }
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
              <a href="/docs#workspace">{lang === 'zh' ? '消息与工作区' : 'Messages & Workspace'}</a>
              <a href="/docs#automation">{lang === 'zh' ? '自动化与频道' : 'Automation & Channels'}</a>
              <a href="/docs#settings">{lang === 'zh' ? '系统设置' : 'Settings'}</a>
            </div>
            <div className="footer-col">
              <h4>{t('footer.colAbout')}</h4>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">{t('footer.license')}</a>
              <a href={`${GITHUB_URL}/releases`} target="_blank" rel="noopener noreferrer">{t('footer.changelog')}</a>
              <a href={`${GITHUB_URL}/issues/new`} target="_blank" rel="noopener noreferrer">{lang === 'zh' ? '联系我们' : 'Contact Us'}</a>
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