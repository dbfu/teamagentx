/**
 * remark 插件：处理 @mentions
 *
 * 将有效的 @助手名 转换为带有特殊 class 的 HTML span 标签，
 * 以便 ReactMarkdown 的自定义组件可以识别并渲染为高亮元素。
 *
 * 前面可以是：空格、字符串开头、或 markdown 特殊字符（*、_、>、-、#、`）
 * 后面必须是：空格、字符串结尾、常见标点，或不属于名称的连字符
 */

import { visit } from 'unist-util-visit'

// 允许出现在 @ 前面的 markdown 特殊字符和常见标点
const MENTION_PREFIX_BOUNDARY_CHARS = '*_>#`!?.,:;！？。，；：-'
const END_BOUNDARY_CHARS = '*_>#`!?.,:;！？。，；：'
const NAME_CHARS_PATTERN = '[\\u4e00-\\u9fa5a-zA-Z0-9_]'

// 用于识别我们插入的 mention span 的唯一标记
export const MENTION_MARKER_CLASS = 'teamagentx-mention-highlight'

interface MentionAgent {
  id: string
  name: string
}

interface Options {
  mentionAgents: MentionAgent[]
  onMentionClick?: (agentId: string, agentName: string) => void
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * remark 插件：处理 @mentions
 *
 * @param opts - 配置选项
 * @param opts.mentionAgents - 群聊中的助手列表，用于验证 mention 是否有效
 * @param opts.onMentionClick - 点击 mention 时的回调函数（可选）
 */
export function remarkMentions(opts: Options) {
  const { mentionAgents } = opts

  // 创建 agent name 到 agent 信息的映射
  const agentMap = new Map<string, MentionAgent>()
  for (const agent of mentionAgents) {
    agentMap.set(agent.name, agent)
  }

  const mentionPattern = Array.from(agentMap.keys())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')

  const mentionRegex = mentionPattern
    ? new RegExp(`@(${mentionPattern})(?=\\s|$|[${END_BOUNDARY_CHARS}]|-(?!${NAME_CHARS_PATTERN}))`, 'g')
    : null

  return (tree: any, file: any) => {
    if (!mentionRegex) return

    // 获取原始 markdown 文本（file.value 或 file.contents）
    const originalText: string = file?.value ?? file?.contents ?? ''

    visit(tree, 'text', (node: any, index: number | undefined, parent: any) => {
      if (!node.value || typeof node.value !== 'string') return

      const content = node.value
      const startOffset = node.position?.start?.offset ?? 0

      // 收集要替换的片段
      const fragments: Array<{ type: 'text'; value: string } | { type: 'html'; value: string }> = []
      let lastIndex = 0
      let hasMention = false

      // 重置正则
      mentionRegex.lastIndex = 0

      let match
      while ((match = mentionRegex.exec(content)) !== null) {
        const mentionText = match[0] // @助手名
        const matchIndex = match.index
        const agentName = match[1] // 去掉 @

        // 检查 agent 是否有效
        const agent = agentMap.get(agentName)
        if (!agent) continue

        // 检查 @ 前面的边界条件
        // 在 AST 文本中，matchIndex 表示 @ 在这个 text 节点中的位置
        // 需要检查原始 markdown 中对应位置前面是否是空白

        const absoluteOffset = startOffset + matchIndex
        let isBoundaryValid = false

        if (matchIndex === 0) {
          // @ 在 text 节点开头，需要检查原始位置
          if (absoluteOffset === 0) {
            // 文档开头，有效
            isBoundaryValid = true
          } else if (originalText.length > 0) {
            // 检查原始文本中前面一个字符是否是空白或边界字符
            const prevChar = originalText[absoluteOffset - 1]
            if (/\s/.test(prevChar) || MENTION_PREFIX_BOUNDARY_CHARS.includes(prevChar)) {
              isBoundaryValid = true
            }
          }
        } else {
          // @ 在 text 节点中间，检查 text 节点内前面是否是空白或 markdown 特殊字符
          const prevCharInNode = content[matchIndex - 1]
          if (/\s/.test(prevCharInNode) || MENTION_PREFIX_BOUNDARY_CHARS.includes(prevCharInNode)) {
            isBoundaryValid = true
          }
        }

        if (!isBoundaryValid) continue

        // 有效 mention
        hasMention = true

        // 添加前面的普通文本
        if (matchIndex > lastIndex) {
          fragments.push({ type: 'text', value: content.slice(lastIndex, matchIndex) })
        }

        // 添加 mention HTML
        fragments.push({
          type: 'html',
          value: `<span class="${MENTION_MARKER_CLASS}" data-agent-id="${escapeHtml(agent.id)}" data-agent-name="${escapeHtml(agentName)}">${escapeHtml(mentionText)}</span>`,
        })

        lastIndex = matchIndex + mentionText.length
      }

      // 如果有 mention，替换原节点
      if (hasMention) {
        // 添加剩余文本
        if (lastIndex < content.length) {
          fragments.push({ type: 'text', value: content.slice(lastIndex) })
        }

        // 替换原节点
        if (index !== undefined && parent) {
          parent.children.splice(index, 1, ...fragments)
        }
      }
    })
  }
}
