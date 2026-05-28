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
      { text: '使用手册', link: '/user-guide/' },
      { text: '快速开始', link: '/getting-started' },
      { text: '功能介绍', link: '/features' },
      { text: '配置指南', link: '/configuration/' },
    ],

    sidebar: [
      {
        text: '用户手册',
        items: [
          { text: '简介', link: '/' },
          { text: '手册目录', link: '/user-guide/' },
          { text: '首次设置', link: '/user-guide/first-run' },
          { text: '模型管理', link: '/user-guide/models' },
          { text: '助手管理', link: '/user-guide/agents' },
          { text: '群聊与消息', link: '/user-guide/chatrooms' },
          { text: '快速对话', link: '/user-guide/quick-chat' },
          { text: '技能管理', link: '/user-guide/skills' },
          { text: '定时任务', link: '/user-guide/cron-tasks' },
          { text: '频道集成', link: '/user-guide/integrations' },
          { text: '设置与多端连接', link: '/user-guide/settings' },
        ]
      },
      {
        text: '项目与部署',
        items: [
          { text: '快速开始', link: '/getting-started' },
          { text: '功能介绍', link: '/features' },
          { text: '安装部署', link: '/installation' },
        ]
      },
      {
        text: '配置',
        link: '/configuration/',
        items: [
          { text: '环境变量', link: '/configuration/env' },
          { text: 'LLM 配置', link: '/configuration/llm' },
          { text: '智能体设置', link: '/configuration/agent-settings' },
        ]
      },
      {
        text: '开发',
        link: '/development/',
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
