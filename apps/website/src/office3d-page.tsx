import { useEffect } from 'react'
import { GITHUB_URL, GitHubIcon, sectionIcon } from './shared-components'
import type { SiteConfig } from './site-config'
import { DownloadButton } from './download-button'
import { useLanguage } from './i18n/context'
import { LanguageSelect } from './components/language-select'

interface Office3dPageProps {
  siteConfig?: SiteConfig
}

export function Office3dPage({ siteConfig }: Office3dPageProps) {
  const { lang, setLang, t } = useLanguage()

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
          <a href="/office" className="active">{t('nav.office3d')}</a>
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
          <DownloadButton siteConfig={siteConfig} variant="desktop" />
          <DownloadButton siteConfig={siteConfig} variant="mobile" />
        </div>
      </header>

      {/* ── 主内容 ── */}
      <main className="docs-layout" style={{ gridTemplateColumns: '1fr' }}>
        <div className="docs-main" style={{ maxWidth: '100%' }}>
          {/* Hero —— 与功能特性等 Tab 页保持一致 */}
          <section className="docs-hero features-hero">
            <div className="docs-hero-badge">{sectionIcon('cube')}{t('office3d.eyebrow')}</div>
            <h1>{t('office3d.title')}</h1>
            <p>{t('office3d.desc')}</p>
          </section>

          {/* 视频介绍 */}
          <div className="office3d-video reveal">
            <video
              className="office3d-video-el"
              src="https://teamagentx.oss-cn-shanghai.aliyuncs.com/teamagentx%203D%E6%BC%94%E7%A4%BA.mp4"
              autoPlay
              muted
              loop
              playsInline
            />
          </div>

          {/* 特性卡片 */}
          <div className="office3d-features reveal">
            <article className="office3d-card">
              <h3>{t('office3d.feature1Title')}</h3>
              <p>{t('office3d.feature1Desc')}</p>
            </article>
            <article className="office3d-card">
              <h3>{t('office3d.feature2Title')}</h3>
              <p>{t('office3d.feature2Desc')}</p>
            </article>
            <article className="office3d-card">
              <h3>{t('office3d.feature3Title')}</h3>
              <p>{t('office3d.feature3Desc')}</p>
            </article>
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
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="footer-oss-link">
            <GitHubIcon size={12} />{t('footer.githubRepo')}
          </a>
        </div>
      </footer>
    </div>
  )
}
