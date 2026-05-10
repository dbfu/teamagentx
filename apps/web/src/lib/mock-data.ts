// 聊天应用的模拟数据

export interface Contact {
  id: string
  name: string
  avatar: string
  isBot?: boolean
  lastMessage?: string
  time?: string
  unread?: number
  badge?: string
}

export interface Message {
  id: string
  sender: {
    name: string
    avatar: string
    isBot?: boolean
  }
  content: string
  time?: string
  replyTo?: {
    name: string
    content: string
  }
  reactions?: {
    emoji: string
    count?: number
  }[]
  replyCount?: number
}

export const quickContacts: Contact[] = [
  { id: '1', name: 'openclaw', avatar: '/avatars/openclaw.png' },
  { id: '2', name: '数学助手', avatar: '/avatars/math.png' },
  { id: '3', name: '每日问答', avatar: '/avatars/daily.png' },
]

export const conversations: Contact[] = [
  {
    id: '1',
    name: 'OpenClaw 插件...',
    avatar: '/avatars/openclaw.png',
    lastMessage: '七月：帮我看看这个',
    time: '09:09',
    unread: 74,
    badge: 'OpenClaw',
  },
  {
    id: '2',
    name: '每日问答',
    avatar: '/avatars/daily.png',
    isBot: true,
    lastMessage: '任务完成。摘要：1. 阅读...',
    time: '昨天',
  },
  {
    id: '3',
    name: '前端开发',
    avatar: '/avatars/frontend.png',
    lastMessage: '每日 React 面试 #7...',
    time: '昨天',
  },
  {
    id: '4',
    name: '安全中心',
    avatar: '/avatars/security.png',
    isBot: true,
    lastMessage: '授权通知',
    time: '3月18日',
  },
  {
    id: '5',
    name: '面试群',
    avatar: '/avatars/interview.png',
    lastMessage: '面试官：哈哈，666 不是...',
    time: '3月18日',
  },
  {
    id: '6',
    name: '小说专家',
    avatar: '/avatars/novel.png',
    isBot: true,
    lastMessage: '任务完成！摘要：1. 阅读...',
    time: '3月17日',
  },
  {
    id: '7',
    name: '飞书俱乐部',
    avatar: '/avatars/fly.png',
    isBot: true,
    lastMessage: '飞书支持一键部署...',
    time: '3月16日',
  },
  {
    id: '8',
    name: '日历机器人',
    avatar: '/avatars/calendar.png',
    isBot: true,
    lastMessage: '日历已分享',
    time: '3月16日',
  },
  {
    id: '9',
    name: '开发助手',
    avatar: '/avatars/dev.png',
    isBot: true,
    lastMessage: '构建部署成功',
    time: '3月12日',
  },
  {
    id: '10',
    name: '面试官',
    avatar: '/avatars/interviewer.png',
    isBot: true,
    lastMessage: '已修复冲突问题！原因：P...',
    time: '3月12日',
  },
  {
    id: '11',
    name: '候选人',
    avatar: '/avatars/interviewee.png',
    isBot: true,
    lastMessage: '第二题 候选人：李明...',
    time: '3月12日',
  },
  {
    id: '12',
    name: '数学助手',
    avatar: '/avatars/math.png',
    isBot: true,
    lastMessage: '太棒了！模拟完成...',
    time: '3月9日',
  },
]

export const chatMessages: Message[] = [
  {
    id: '1',
    sender: {
      name: '面试官',
      avatar: '/avatars/interviewer.png',
      isBot: true,
    },
    replyTo: {
      name: '前端开发',
      content: '@面试官 你好',
    },
    content: '你好！我是面试官 AI，准备好进行技术面试了。\n要开始面试，请发送：\n1. 候选人简历内容\n2. 或者直接说"开始面试"并附上简历\n我会根据简历生成技术问题，记录整个面试过程，并提供综合评估。\n有什么可以帮助你的吗？',
  },
  {
    id: '2',
    sender: {
      name: '面试官',
      avatar: '/avatars/interviewer.png',
      isBot: true,
    },
    replyTo: {
      name: '面试官',
      content: '第二题 候选人：李明 职位：中级前端工程师（React）问题：李明，我了解到你熟悉多种状态管理方案：Redux、MobX、Recoil。请回答这个问题：在你的电商移动应用中...',
    },
    content: '@面试官 666',
    reactions: [{ emoji: 'check' }],
    replyCount: 1,
  },
  {
    id: '3',
    sender: {
      name: '面试官',
      avatar: '/avatars/interviewer.png',
      isBot: true,
    },
    replyTo: {
      name: '前端开发',
      content: '@面试官 666',
    },
    content: '哈哈，"666" 不是技术答案！\n李明，我需要听到你选择状态管理方案的真实想法和理由。这个问题考察：\n1. **技术选型能力** - 为什么选 A 而不是 B\n2. **工具深度理解** - Redux Toolkit 与传统 Redux 的核心区别\n3. **场景判断** - 何时使用轻量级方案\n你可以从这些角度分享你的想法：\n* 购物车状态有什么特点？（频繁更新？需要持久化？需要时间旅行调试？）\n* 你的团队规模和技术栈偏好是什么？\n* 你在实际项目中遇到过哪些状态管理的坑？\n期待你的技术分享！',
  },
]

export const currentChat = {
  id: '5',
  name: '面试群',
  memberCount: 1,
  pinnedCount: 2,
  members: [
    { id: '1', name: '面试官', avatar: '/avatars/interviewer.png', isBot: true },
    { id: '2', name: '候选人', avatar: '/avatars/interviewee.png', isBot: true },
    { id: '3', name: '数学助手', avatar: '/avatars/math.png', isBot: true },
  ],
}