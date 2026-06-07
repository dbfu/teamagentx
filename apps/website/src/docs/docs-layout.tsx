import { useEffect, type ReactNode } from 'react'
import type { SiteConfig } from '../site-config'
import { DownloadButton } from '../download-button'
import { MANUAL_GROUPS } from './manual'
import { useLanguage } from '../i18n/context'

interface DocsLayoutProps {
  siteConfig: SiteConfig
  activeSlug: string
  children: ReactNode
}

export function DocsLayout({ siteConfig, activeSlug, children }: DocsLayoutProps) {
  const { t } = useLanguage()
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

      <header className="top-nav docs-top-nav">
        <a className="nav-logo" href="/" aria-label="TeamAgentX Home">
          <img src="/app-logo.png" alt="TeamAgentX" width={28} height={28} />
          <span>TeamAgentX</span>
        </a>
        <nav className="nav-links docs-nav-links">
          <a href="/">{t('docs.navHome')}</a>
          <a href="/office">{t('docs.navOffice3d')}</a>
          <a href="/features">{t('docs.navFeatures')}</a>
          <a href="/workflow">{t('docs.navWorkflow')}</a>
          <a href="/showcase">{t('docs.navShowcase')}</a>
          <a href="/templates">{t('docs.navTemplates')}</a>
          <a href="/docs" className="active">{t('docs.navDocs')}</a>
        </nav>
        <div className="nav-actions">
          <a href="/docs/first-run" className="btn btn-outline">{t('docs.startBtn')}</a>
          <DownloadButton siteConfig={siteConfig} variant="desktop" />
          <DownloadButton siteConfig={siteConfig} variant="mobile" />
        </div>
      </header>

      <main className="docs-layout">
        <aside className="docs-sidebar">
          <nav className="docs-toc docs-manual-toc">
            {MANUAL_GROUPS.map((group) => (
              <div className="docs-toc-group" key={group.title}>
                <div className="docs-toc-group-label">{getGroupTitle(t, group.title)}</div>
                {group.items.map((item) => (
                  <a
                    key={item.slug || 'overview'}
                    href={item.path}
                    className={item.slug === activeSlug ? 'active' : undefined}
                  >
                    <strong>{getPageTitle(t, item.title, item.shortTitle)}</strong>
                  </a>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <div className="docs-main">
          <article className="docs-article">{children}</article>
          <p className="download-note">{t('docs.downloadNote')} {siteConfig.version} · {t('docs.downloadNoteSuffix')}</p>
        </div>
      </main>
    </div>
  )
}

// 翻译侧栏分组标题的辅助函数
function getGroupTitle(t: (key: string) => string, originalTitle: string): string {
  const groupKeyMap: Record<string, string> = {
    '开始使用': 'docs.groupStart',
    '核心功能': 'docs.groupCore',
    '能力扩展': 'docs.groupExtend',
    '多端使用': 'docs.groupMultiDevice',
    '系统设置': 'docs.groupSettings',
  }
  const key = groupKeyMap[originalTitle]
  return key ? t(key) : originalTitle
}

// 翻译页面标题的辅助函数
function getPageTitle(t: (key: string) => string, title: string, shortTitle?: string): string {
  const pageKeyMap: Record<string, { title: string; short?: string }> = {
    '产品概览': { title: 'docs.pageOverview', short: 'docs.pageOverviewShort' },
    '安装与启动': { title: 'docs.pageFirstRun' },
    '模型管理': { title: 'docs.pageModels' },
    '助手管理': { title: 'docs.pageAgents' },
    '快速对话': { title: 'docs.pageQuickChat' },
    '群聊与消息': { title: 'docs.pageChatrooms' },
    '系统群助手': { title: 'docs.pageSystemAssistant' },
    '技能管理': { title: 'docs.pageSkills' },
    '定时任务': { title: 'docs.pageCronTasks' },
    '频道集成': { title: 'docs.pageIntegrations' },
    '移动端 App': { title: 'docs.pageMobile', short: 'docs.pageMobileShort' },
    '网页端访问': { title: 'docs.pageWebAccess', short: 'docs.pageWebAccessShort' },
    '系统设置': { title: 'docs.pageSettings' },
  }
  const mapping = pageKeyMap[title]
  if (!mapping) return shortTitle || title
  // 如果有短标题且有对应的翻译 key，优先使用短标题翻译
  if (shortTitle && mapping.short) {
    return t(mapping.short)
  }
  return t(mapping.title)
}
