import { useEffect } from 'react'
import {
  GITHUB_URL,
  getWorkflow,
  GitHubIcon,
  sectionIcon,
} from './shared-components'
import type { SiteConfig } from './site-config'
import { DownloadButton } from './download-button'
import { useLanguage } from './i18n/context'
import { LanguageSelect } from './components/language-select'

interface WorkflowPageProps {
  siteConfig?: SiteConfig
}

export function WorkflowPage({ siteConfig }: WorkflowPageProps) {
  const { lang, setLang, t } = useLanguage()
  const workflow = getWorkflow(lang)

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
          <a href="/features">{t('nav.features')}</a>
          <a href="/workflow" className="active">{t('nav.workflow')}</a>
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
          <section className="docs-hero workflow-hero">
            <div className="docs-hero-badge">{sectionIcon('workflow')}{lang === 'zh' ? '工作流程' : 'Workflow'}</div>
            <h1>{lang === 'zh' ? '四步，让 AI 团队高效运转' : 'Four Steps, Make AI Team Run Efficiently'}</h1>
            <p>
              {lang === 'zh'
                ? '无论什么任务场景，都能快速搭建属于你的 AI 协作团队。从接入模型到下达任务，每一步都简单直观。'
                : 'Whatever task scenario, quickly build your AI collaboration team. From model connection to task assignment, each step is simple and intuitive.'
              }
            </p>
          </section>

          {/* 步骤卡片 */}
          <div className="workflow-steps-full reveal">
            {workflow.map(([step, title, desc, tone]) => (
              <article className={`workflow-step-card workflow-step-${tone}`} key={step}>
                <div className={`step-num-large tone-${tone}`}>{step}</div>
                <div className="workflow-step-content">
                  <h3 className="step-title">{title}</h3>
                  <p className="step-desc">{desc}</p>
                </div>
              </article>
            ))}
          </div>

          {/* 补充说明 */}
          <section className="workflow-extra reveal">
            <h2>{lang === 'zh' ? '为什么选择 TeamAgentX？' : 'Why Choose TeamAgentX?'}</h2>
            <div className="workflow-extra-grid">
              <div className="workflow-extra-item">
                <div className="workflow-extra-icon tone-blue">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <h4>{lang === 'zh' ? '快速上手' : 'Quick Start'}</h4>
                <p>{lang === 'zh' ? '5 分钟内完成首个 AI 工作流，无需复杂配置，填入 API Key 即可开始。' : 'Complete first AI workflow in 5 minutes. No complex config, enter API Key to start.'}</p>
              </div>
              <div className="workflow-extra-item">
                <div className="workflow-extra-icon tone-green">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                </div>
                <h4>{lang === 'zh' ? '灵活调整' : 'Flexible'}</h4>
                <p>{lang === 'zh' ? '随时增减 Agent、修改提示词、调整协作规则，适应不同项目需求。' : 'Add/remove Agents, modify prompts, adjust collaboration rules anytime for different project needs.'}</p>
              </div>
              <div className="workflow-extra-item">
                <div className="workflow-extra-icon tone-purple">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <h4>{lang === 'zh' ? '数据安全' : 'Data Secure'}</h4>
                <p>{lang === 'zh' ? '所有数据本地存储，API Key 仅保存在你的设备，不上传任何云端。' : 'All data stored locally, API Key only saved on your device, no cloud upload.'}</p>
              </div>
              <div className="workflow-extra-item">
                <div className="workflow-extra-icon tone-amber">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 12h8" />
                    <path d="M12 8v8" />
                  </svg>
                </div>
                <h4>{lang === 'zh' ? '完全免费' : 'Free Forever'}</h4>
                <p>{lang === 'zh' ? '开源项目，MIT 协议，无任何付费计划，所有功能永久免费使用。' : 'Open source project, MIT license, no payment plans, all features free forever.'}</p>
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
              <a href="/docs#automation">{lang === 'zh' ? '自动化与频道' : 'Automation'}</a>
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