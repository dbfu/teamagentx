import { useEffect } from 'react'
import {
  GITHUB_URL,
  getOpenSourceItems,
  GitHubIcon,
  openSourceIconSvg,
  sectionIcon,
} from './shared-components'
import type { SiteConfig } from './site-config'
import { DownloadButton } from './download-button'
import { useLanguage } from './i18n/context'
import { LanguageSelect } from './components/language-select'

interface OpensourcePageProps {
  siteConfig?: SiteConfig
}

export function OpensourcePage({ siteConfig }: OpensourcePageProps) {
  const { lang, setLang, t } = useLanguage()
  const openSourceItems = getOpenSourceItems(lang)

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
          <section className="docs-hero opensource-hero">
            <div className="docs-hero-badge">{sectionIcon('opensource')}{lang === 'zh' ? '开源免费' : 'Open Source & Free'}</div>
            <h1>{lang === 'zh' ? '完全免费，永久开源' : 'Free Forever, Open Source'}</h1>
            <p>
              {lang === 'zh'
                ? 'TeamAgentX 是开源项目，MIT 协议授权。当前阶段所有功能免费使用，无任何付费计划。你可以自由部署、二次开发、商业使用。'
                : 'TeamAgentX is an open source project under MIT license. All features free to use, no payment plans. You can freely deploy, modify, and commercialize.'
              }
            </p>
          </section>

          {/* 开源卡片 */}
          <div className="oss-grid-full reveal">
            {openSourceItems.map(({ icon, title, desc, tag, tone }) => (
              <article className={`oss-card oss-card-full oss-card-${tone}`} key={title}>
                <div className={`feature-icon tone-${tone}`}>{openSourceIconSvg(icon)}</div>
                <h3 className="feature-title">{title}</h3>
                <p className="feature-desc">{desc}</p>
                <div className={`feature-tag tone-${tone}`}>{tag}</div>
              </article>
            ))}
          </div>

          {/* GitHub CTA */}
          <div className="oss-github-full reveal">
            <div className="oss-github-info">
              <div className="oss-github-logo"><GitHubIcon size={32} /></div>
              <div>
                <div className="oss-github-name">dbfu / teamagentx</div>
                <div className="oss-github-desc">{lang === 'zh' ? '多模型多 Agent 协作平台 · MIT License · 欢迎 Star & PR' : 'Multi-Model Multi-Agent Platform · MIT License · Star & PR Welcome'}</div>
              </div>
            </div>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-github-cta">
              <GitHubIcon size={16} />{lang === 'zh' ? '前往 GitHub 查看' : 'View on GitHub'}
            </a>
          </div>

          {/* 开源优势 */}
          <section className="opensource-advantages reveal">
            <h2>{lang === 'zh' ? '为什么开源很重要？' : 'Why Open Source Matters?'}</h2>
            <div className="advantages-grid">
              <div className="advantage-item">
                <h4>{lang === 'zh' ? '透明可控' : 'Transparent'}</h4>
                <p>{lang === 'zh' ? '完整源代码公开，每一行代码都可以审查。你知道软件在做什么，没有隐藏行为。' : 'Full source code public, every line auditable. You know what the software does, no hidden behavior.'}</p>
              </div>
              <div className="advantage-item">
                <h4>{lang === 'zh' ? '社区驱动' : 'Community Driven'}</h4>
                <p>{lang === 'zh' ? '全球开发者共同贡献，Bug 更快修复，功能更快迭代。问题可以在 GitHub 直接反馈。' : 'Global developers contribute together, bugs fixed faster, features iterate faster. Report issues on GitHub.'}</p>
              </div>
              <div className="advantage-item">
                <h4>{lang === 'zh' ? '长期保障' : 'Long-term Security'}</h4>
                <p>{lang === 'zh' ? '即使项目停止维护，你也可以继续使用和改进。不会被供应商锁定或强制升级。' : 'Even if project stops, you can continue using and improving. No vendor lock-in or forced upgrade.'}</p>
              </div>
              <div className="advantage-item">
                <h4>{lang === 'zh' ? '学习成长' : 'Learning'}</h4>
                <p>{lang === 'zh' ? '阅读源代码是最好的学习方式。了解 AI Agent 如何协作、任务如何调度、工具如何调用。' : 'Reading source code is the best way to learn. Understand how Agents collaborate, tasks scheduled, tools called.'}</p>
              </div>
            </div>
          </section>

          {/* 贡献指南 */}
          <section className="contribute-section reveal">
            <h2>{lang === 'zh' ? '如何参与贡献？' : 'How to Contribute?'}</h2>
            <div className="contribute-steps">
              <div className="contribute-step">
                <div className="contribute-num">1</div>
                <div>
                  <h4>{lang === 'zh' ? 'Fork 仓库' : 'Fork Repository'}</h4>
                  <p>{lang === 'zh' ? '在 GitHub 上 Fork TeamAgentX 仓库到你的账号。' : 'Fork TeamAgentX repository to your account on GitHub.'}</p>
                </div>
              </div>
              <div className="contribute-step">
                <div className="contribute-num">2</div>
                <div>
                  <h4>{lang === 'zh' ? '做出改动' : 'Make Changes'}</h4>
                  <p>{lang === 'zh' ? '修复 Bug、添加功能、改进文档、优化性能。' : 'Fix bugs, add features, improve docs, optimize performance.'}</p>
                </div>
              </div>
              <div className="contribute-step">
                <div className="contribute-num">3</div>
                <div>
                  <h4>{lang === 'zh' ? '提交 PR' : 'Submit PR'}</h4>
                  <p>{lang === 'zh' ? '推送改动并创建 Pull Request，等待审核合并。' : 'Push changes and create Pull Request, wait for review.'}</p>
                </div>
              </div>
              <div className="contribute-step">
                <div className="contribute-num">4</div>
                <div>
                  <h4>{lang === 'zh' ? '成为贡献者' : 'Become Contributor'}</h4>
                  <p>{lang === 'zh' ? '你的名字将出现在贡献者列表，永久记录在项目历史中。' : 'Your name appears in contributor list, recorded in project history.'}</p>
                </div>
              </div>
            </div>
            <div className="contribute-actions">
              <a href={`${GITHUB_URL}/fork`} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                <GitHubIcon size={14} />{lang === 'zh' ? 'Fork 仓库' : 'Fork Repo'}
              </a>
              <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                {lang === 'zh' ? '查看待解决问题' : 'View Issues'}
              </a>
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