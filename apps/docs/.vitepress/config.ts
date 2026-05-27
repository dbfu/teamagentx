import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'TeamAgentX',
  description: '多智能体协作平台使用文档',
  lang: 'zh-CN',

  head: [
    ['meta', { name: 'theme-color', content: '#3b82f6' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/getting-started' },
      { text: '功能介绍', link: '/features' },
      { text: '配置指南', link: '/configuration' },
    ],

    sidebar: [
      {
        text: '开始',
        items: [
          { text: '简介', link: '/' },
          { text: '快速开始', link: '/getting-started' },
          { text: '安装部署', link: '/installation' },
        ]
      },
      {
        text: '功能',
        items: [
          { text: '智能体管理', link: '/features/agents' },
          { text: '聊天室', link: '/features/chatrooms' },
          { text: '快速对话', link: '/features/quick-chat' },
          { text: '定时任务', link: '/features/cron-tasks' },
        ]
      },
      {
        text: '配置',
        items: [
          { text: '环境变量', link: '/configuration/env' },
          { text: 'LLM 配置', link: '/configuration/llm' },
          { text: '智能体设置', link: '/configuration/agent-settings' },
        ]
      },
      {
        text: '开发',
        items: [
          { text: '架构概览', link: '/development/architecture' },
          { text: '技术栈', link: '/development/tech-stack' },
          { text: '贡献指南', link: '/development/contributing' },
        ]
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/anthropics/claude-code' }
    ],

    footer: {
      message: 'TeamAgentX 使用文档',
      copyright: 'Copyright © 2024-present'
    },

    search: {
      provider: 'local'
    },

    outline: {
      level: [2, 3]
    }
  }
})