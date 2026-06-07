import type { ReactNode } from 'react'
import type { SiteConfig } from './site-config'
import { DocsLayout } from './docs/docs-layout'
import { resolveSlug, findPage } from './docs/manual'
import { OverviewPage } from './docs/pages/overview'
import { FirstRunPage } from './docs/pages/first-run'
import { ModelsPage } from './docs/pages/models'
import { AgentsPage } from './docs/pages/agents'
import { ChatroomsPage } from './docs/pages/chatrooms'
import { SystemAssistantPage } from './docs/pages/system-assistant'
import { QuickChatPage } from './docs/pages/quick-chat'
import { SkillsPage } from './docs/pages/skills'
import { CronTasksPage } from './docs/pages/cron-tasks'
import { IntegrationsPage } from './docs/pages/integrations'
import { MobilePage } from './docs/pages/mobile'
import { WebAccessPage } from './docs/pages/web-access'
import { SettingsPage } from './docs/pages/settings'

// slug → 内容组件 映射，单一数据源见 docs/manual.ts
const PAGE_CONTENT: Record<string, () => ReactNode> = {
  '': OverviewPage,
  'first-run': FirstRunPage,
  'models': ModelsPage,
  'agents': AgentsPage,
  'chatrooms': ChatroomsPage,
  'system-assistant': SystemAssistantPage,
  'quick-chat': QuickChatPage,
  'skills': SkillsPage,
  'cron-tasks': CronTasksPage,
  'integrations': IntegrationsPage,
  'mobile': MobilePage,
  'web-access': WebAccessPage,
  'settings': SettingsPage,
}

interface DocsPageProps {
  siteConfig: SiteConfig
}

export function DocsPage({ siteConfig }: DocsPageProps) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/docs'
  const rawSlug = resolveSlug(pathname)
  // 未知 slug 回退到概览页
  const slug = findPage(rawSlug) ? rawSlug : ''
  const Content = PAGE_CONTENT[slug] ?? OverviewPage

  return (
    <DocsLayout siteConfig={siteConfig} activeSlug={slug}>
      <Content />
    </DocsLayout>
  )
}
