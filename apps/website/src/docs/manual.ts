// 使用手册页面清单：作为侧栏导航与 slug→组件 映射的单一数据源。

export interface ManualPageMeta {
  slug: string // 路由 slug，空字符串表示 /docs 默认页
  path: string // 完整路径，例如 /docs/agents
  title: string // 侧栏与页面标题
  shortTitle?: string // 侧栏短标题（可选）
}

export interface ManualGroup {
  title: string
  items: ManualPageMeta[]
}

function page(slug: string, title: string, shortTitle?: string): ManualPageMeta {
  return {
    slug,
    path: slug ? `/docs/${slug}` : '/docs',
    title,
    shortTitle,
  }
}

export const MANUAL_GROUPS: ManualGroup[] = [
  {
    title: '开始使用',
    items: [
      page('', '产品概览', '概览'),
      page('first-run', '安装与启动'),
    ],
  },
  {
    title: '核心功能',
    items: [
      page('models', '模型管理'),
      page('agents', '助手管理'),
      page('quick-chat', '快速对话'),
      page('chatrooms', '群聊与消息'),
      page('system-assistant', '系统群助手'),
    ],
  },
  {
    title: '能力扩展',
    items: [
      page('skills', '技能管理'),
      page('cron-tasks', '定时任务'),
      page('integrations', '频道集成'),
    ],
  },
  {
    title: '多端使用',
    items: [
      page('mobile', '移动端 App', '移动端'),
      page('web-access', '网页端访问', '网页端'),
    ],
  },
  {
    title: '系统设置',
    items: [page('settings', '系统设置')],
  },
]

export const MANUAL_PAGES: ManualPageMeta[] = MANUAL_GROUPS.flatMap((group) => group.items)

// 根据 pathname 解析出当前 slug（去掉 /docs 前缀，去掉首尾斜杠）。
export function resolveSlug(pathname: string): string {
  const rest = pathname.replace(/^\/docs/, '').replace(/^\/+|\/+$/g, '')
  return rest
}

export function findPage(slug: string): ManualPageMeta | undefined {
  return MANUAL_PAGES.find((item) => item.slug === slug)
}
