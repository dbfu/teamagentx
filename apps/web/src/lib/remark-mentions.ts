/**
 * remark 插件：处理 @mentions
 *
 * 将有效的 @助手名 转换为带有特殊 class 的 HTML span 标签，
 * 以便 ReactMarkdown 的自定义组件可以识别并渲染为高亮元素。
 *
 * 前面可以是：空格、字符串开头、或 markdown 特殊字符（*、_、>、-、#、`）
 * 后面必须是：空格或字符串结尾（严格边界，与后端规则一致）
 */

import { visit } from 'unist-util-visit'

// 匹配 @助手名 的正则（支持中文、英文、数字、下划线、连字符）
// 名称可以包含连字符，但不能以连字符开头或结尾
// 使用非贪婪匹配 +? 防止过度匹配
// 使用 lookbehind (?<=) 确保名称不以 - 结尾
// 特殊处理连字符：只有当连字符后面没有名称字符时，才作为边界
const MENTION_REGEX = /(@[\u4e00-\u9fa5a-zA-Z0-9_][\u4e00-\u9fa5a-zA-Z0-9_-]*?)(?<=[\u4e00-\u9fa5a-zA-Z0-9_])(?=\s|$|[*_>#`!?.,:;！？。，；：]|-(?![\u4e00-\u9fa5a-zA-Z0-9_]))/g

// 允许出现在 @ 前面的 markdown 特殊字符
const MARKDOWN_SPECIAL_CHARS = '*_>#`-'

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

  return (tree: any, file: any) => {
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
      MENTION_REGEX.lastIndex = 0

      let match
      while ((match = MENTION_REGEX.exec(content)) !== null) {
        const mentionText = match[1] // @助手名
        const matchIndex = match.index
        const agentName = mentionText.slice(1) // 去掉 @

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
            // 检查原始文本中前面一个字符是否是空白或 markdown 特殊字符
            const prevChar = originalText[absoluteOffset - 1]
            if (/\s/.test(prevChar) || MARKDOWN_SPECIAL_CHARS.includes(prevChar)) {
              isBoundaryValid = true
            }
          }
        } else {
          // @ 在 text 节点中间，检查 text 节点内前面是否是空白或 markdown 特殊字符
          const prevCharInNode = content[matchIndex - 1]
          if (/\s/.test(prevCharInNode) || MARKDOWN_SPECIAL_CHARS.includes(prevCharInNode)) {
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
          value: `<span class="${MENTION_MARKER_CLASS}" data-agent-id="${agent.id}" data-agent-name="${agentName}">${mentionText}</span>`,
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