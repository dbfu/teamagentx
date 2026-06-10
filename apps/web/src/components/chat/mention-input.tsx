import { cn } from '@/lib/utils'
import { Bot } from 'lucide-react'
import { useState, useRef, useCallback, useEffect, useImperativeHandle, useMemo, forwardRef } from 'react'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { useTranslation } from 'react-i18next'

interface Agent {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
}

interface MentionInputProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  placeholder?: string
  agents: Agent[]
  className?: string
  onMentionClick?: (agentId: string, agentName: string) => void
  customCommands?: CustomCommand[]
}

interface CustomCommand {
  name: string
  content: string
}

interface MentionData {
  id: string
  agentId: string
  agentName: string
  start: number
  end: number
}

interface SlashCommand {
  command: string
  title: string
  description: string
  // 选中后插入到输入框的文本，默认等于 command；自定义指令为其内容
  insertText?: string
}

// 撤销历史栈
interface HistoryEntry {
  value: string
  cursorOffset: number
}

const SLASH_COMMANDS = (t: (key: string) => string): SlashCommand[] => [
  {
    command: '/new',
    title: t('input.slashNew'),
    description: t('input.slashNewDesc'),
  },
  {
    command: '/clear',
    title: t('input.slashClear'),
    description: t('input.slashClearDesc'),
  },
  {
    command: '/git status',
    title: t('input.slashGitStatus'),
    description: t('input.slashGitStatusDesc'),
  },
  {
    command: '/git init',
    title: t('input.slashGitInit'),
    description: t('input.slashGitInitDesc'),
  },
  {
    command: '/git diff',
    title: t('input.slashGitDiff'),
    description: t('input.slashGitDiffDesc'),
  },
  {
    command: '/git add .',
    title: t('input.slashGitAddAll'),
    description: t('input.slashGitAddAllDesc'),
  },
  {
    command: '/git commit',
    title: t('input.slashGitCommit'),
    description: t('input.slashGitCommitDesc'),
  },
  {
    command: '/git log',
    title: t('input.slashGitLog'),
    description: t('input.slashGitLogDesc'),
  },
  {
    command: '/git branch',
    title: t('input.slashGitBranch'),
    description: t('input.slashGitBranchDesc'),
  },
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')
}

export interface MentionInputRef {
  focus: () => void
}

export const MentionInput = forwardRef<MentionInputRef, MentionInputProps>(function MentionInput({
  value,
  onChange,
  onKeyDown,
  placeholder,
  agents,
  className,
  onMentionClick,
  customCommands,
}, ref) {
  const { t } = useTranslation()
  const [showMentions, setShowMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionLeft, setMentionLeft] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showSlashCommands, setShowSlashCommands] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashLeft, setSlashLeft] = useState(0)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const editorRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const selectedItemRef = useRef<HTMLDivElement>(null)
  const commandDropdownRef = useRef<HTMLDivElement>(null)
  const selectedCommandRef = useRef<HTMLDivElement>(null)
  const isComposingRef = useRef(false)

  // 暴露 focus 方法给父组件
  useImperativeHandle(ref, () => ({
    focus: () => {
      if (editorRef.current) {
        editorRef.current.focus()
      }
    },
  }), [])

  // 撤销历史栈
  const historyRef = useRef<HistoryEntry[]>([])
  const historyIndexRef = useRef(-1)
  const isUndoRedoRef = useRef(false)
  const prevValueRef = useRef(value)
  const lastDomSyncValueRef = useRef<string | null>(null)
  const MAX_HISTORY_SIZE = 50

  // 解析文本中的 @mentions
  const parseMentions = useCallback((text: string): MentionData[] => {
    const mentions: MentionData[] = []
    const agentNames = agents
      .map(a => a.name)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
    if (agentNames.length === 0) return mentions

    // 支持 @ 前面是：空格、字符串开头、或 markdown 特殊字符（*、_、>、-、#、`）
    // @ 后面是：空格、字符串结尾、或标点符号
    // 特殊处理名称中的连字符：只有当连字符后面没有名称字符时，才作为边界
    // 注意：模板字符串中 $ 直接写（不转义）表示正则的字符串结尾
    const boundaryChars = '*_>#`!?.,:;！？。，；：-'
    const endBoundaryChars = '*_>#`!?.,:;！？。，；：'
    const regex = new RegExp(`(?:^|\\s|[${boundaryChars}])@(${agentNames.join('|')})(?=\\s|$|[${endBoundaryChars}]|-(?![\\u4e00-\\u9fa5a-zA-Z0-9_]))`, 'g')
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const agentName = match[1]
      if (!agentName) continue
      const agent = agents.find(a => a.name === agentName)
      // match[0] 可能包含前置字符（空格或特殊字符），需要计算实际 @ 的位置
      const fullMatch = match[0]
      // 如果匹配以非 @ 字符开头（空格或特殊字符），需要偏移 1
      const atIndex = match.index + (fullMatch[0] !== '@' ? 1 : 0)
      mentions.push({
        id: `mention-${atIndex}`,
        agentId: agent?.id ?? '',
        agentName: agentName,
        start: atIndex,
        end: atIndex + 1 + agentName.length,
      })
    }
    return mentions
  }, [agents])

  const mentions = useMemo(() => parseMentions(value), [parseMentions, value])

  // 渲染编辑器内容的公共函数
  const renderEditorContent = useCallback((textValue: string, cursorOffset: number) => {
    if (!editorRef.current) return

    // 清空编辑器
    editorRef.current.innerHTML = ''

    if (!textValue) return

    // 解析 mentions
    const newMentions = parseMentions(textValue)

    if (newMentions.length > 0) {
      // 有 mentions，渲染高亮
      type Fragment = { type: 'text'; content: string } | { type: 'mention'; data: MentionData }
      const fragments: Fragment[] = []
      let lastIndex = 0

      for (const mention of newMentions) {
        if (mention.start > lastIndex) {
          fragments.push({ type: 'text', content: textValue.slice(lastIndex, mention.start) })
        }
        fragments.push({ type: 'mention', data: mention })
        lastIndex = mention.end
      }
      if (lastIndex < textValue.length) {
        fragments.push({ type: 'text', content: textValue.slice(lastIndex) })
      }

      const nodes: Node[] = []
      for (const fragment of fragments) {
        if (fragment.type === 'text') {
          nodes.push(document.createTextNode(fragment.content))
        } else {
          const span = document.createElement('span')
          span.setAttribute('data-mention-id', fragment.data.id)
          span.setAttribute('data-mention-name', fragment.data.agentName)
          span.setAttribute('contenteditable', 'false')
          span.className = 'inline-flex items-center rounded px-0.5 text-primary cursor-pointer hover:bg-primary/10'
          span.textContent = `@${fragment.data.agentName}`
          span.addEventListener('click', (ev) => {
            ev.stopPropagation()
            if (onMentionClick) {
              onMentionClick(fragment.data.agentId, fragment.data.agentName)
            }
          })
          nodes.push(span)
        }
      }
      nodes.forEach(node => editorRef.current!.appendChild(node))
    } else {
      // 没有 mentions，设置纯文本
      editorRef.current.textContent = textValue
    }

    // 设置光标位置
    const range = document.createRange()
    const selection = window.getSelection()
    const textNodes: Text[] = []
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        textNodes.push(node as Text)
      } else {
        node.childNodes.forEach(walk)
      }
    }
    editorRef.current.childNodes.forEach(walk)

    if (textNodes.length > 0) {
      let currentPos = 0
      for (const node of textNodes) {
        const len = node.length
        if (currentPos + len >= cursorOffset) {
          range.setStart(node, Math.min(cursorOffset - currentPos, len))
          range.collapse(true)
          break
        }
        currentPos += len
      }
      if (selection) {
        selection.removeAllRanges()
        selection.addRange(range)
      }
    } else if (editorRef.current.childNodes.length > 0) {
      // 有 mention 元素但没有文本节点，将光标设置到最后
      const lastNode = editorRef.current.childNodes[editorRef.current.childNodes.length - 1]
      range.selectNodeContents(lastNode)
      range.collapse(false)
      if (selection) {
        selection.removeAllRanges()
        selection.addRange(range)
      }
    } else {
      // 编辑器为空，将光标设置到编辑器本身
      range.selectNodeContents(editorRef.current)
      range.collapse(true)
      if (selection) {
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
  }, [parseMentions, onMentionClick])

  // 重置历史栈（当外部清空 value 时）
  const resetHistory = useCallback(() => {
    historyRef.current = [{ value: '', cursorOffset: 0 }]
    historyIndexRef.current = 0
  }, [])

  // 添加历史记录
  const pushHistory = useCallback((newValue: string, cursorOffset?: number) => {
    if (isUndoRedoRef.current) return

    const offset = cursorOffset ?? newValue.length

    // 如果历史栈有内容且当前值和上一个值相同，不添加
    if (historyRef.current.length > 0 && historyRef.current[historyIndexRef.current]?.value === newValue) {
      return
    }

    // 截断后面的历史（当用户在撤销后又输入新内容时）
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1)
    }

    // 添加新记录
    historyRef.current.push({ value: newValue, cursorOffset: offset })

    // 限制历史大小
    if (historyRef.current.length > MAX_HISTORY_SIZE) {
      historyRef.current.shift()
      historyIndexRef.current--
    }

    historyIndexRef.current = historyRef.current.length - 1
  }, [])

  // 撤销
  const undo = useCallback(() => {
    // 可以撤销到空状态（index = -1）
    if (historyIndexRef.current < 0) return null

    historyIndexRef.current--
    isUndoRedoRef.current = true

    // 如果撤销到 -1，返回空状态
    if (historyIndexRef.current < 0) {
      return { value: '', cursorOffset: 0 }
    }

    const entry = historyRef.current[historyIndexRef.current]
    return entry
  }, [])

  // 重做
  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return null

    historyIndexRef.current++
    isUndoRedoRef.current = true
    const entry = historyRef.current[historyIndexRef.current]
    return entry
  }, [])

  // 初始化历史栈
  useEffect(() => {
    if (historyRef.current.length === 0) {
      resetHistory()
    }
  }, [resetHistory])

  // 监听 value 变化，当外部清空时重置历史
  useEffect(() => {
    // 如果 value 从非空变为空，且不是因为撤销操作，重置历史栈
    if (prevValueRef.current !== '' && value === '' && !isUndoRedoRef.current) {
      resetHistory()
    }
    prevValueRef.current = value
  }, [value, resetHistory])

  // 选中项变化时自动滚动到可见区域
  useEffect(() => {
    if (selectedItemRef.current && dropdownRef.current) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  useEffect(() => {
    if (selectedCommandRef.current && commandDropdownRef.current) {
      selectedCommandRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedCommandIndex])

  // 过滤助手列表
  const filteredAgents = agents
    .filter(a => !mentionQuery || a.name.toLowerCase().includes(mentionQuery.toLowerCase()))

  // 自定义指令排在内置指令之前，选中后填充指令内容
  const allCommands = useMemo<SlashCommand[]>(() => {
    const customs: SlashCommand[] = (customCommands ?? []).map((cmd) => ({
      command: `/${cmd.name}`,
      title: cmd.name,
      description: cmd.content,
      insertText: cmd.content,
    }))
    return [...customs, ...SLASH_COMMANDS(t)]
  }, [customCommands, t])

  const filteredCommands = allCommands.filter((item) => {
    const query = slashQuery.toLowerCase()
    return (
      !query ||
      item.command.slice(1).toLowerCase().includes(query) ||
      item.title.toLowerCase().includes(query)
    )
  })

  // 获取纯文本内容（正确处理 contentEditable 中的换行符）
  // contentEditable 中浏览器通常使用 <div> 或 <br> 表示换行
  // textContent 不会将 <div> 边界转换为 \n，需要手动处理
  const getPlainText = useCallback(() => {
    if (!editorRef.current) return ''

    // 遍历 DOM 并正确处理块级元素和换行符
    const walk = (node: Node, isFirstInBlock: boolean = true): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || ''
      }

      if (node.nodeName === 'BR') {
        return '\n'
      }

      // 块级元素（div, p）需要在前后添加换行符
      if (node.nodeName === 'DIV' || node.nodeName === 'P') {
        let result = ''
        // 如果不是第一个块级元素，前面加换行符
        if (!isFirstInBlock) {
          result += '\n'
        }
        // 遍历子节点
        let childIsFirst = true
        node.childNodes.forEach(child => {
          const childText = walk(child, childIsFirst)
          result += childText
          childIsFirst = false
        })
        return result
      }

      // 其他元素（如 span），遍历子节点但不添加换行符
      let result = ''
      node.childNodes.forEach(child => {
        result += walk(child, isFirstInBlock)
      })
      return result
    }

    // 根元素遍历，每个顶级 div/p 是一个段落
    let result = ''
    let isFirstBlock = true
    editorRef.current.childNodes.forEach(child => {
      if (child.nodeName === 'DIV' || child.nodeName === 'P') {
        if (!isFirstBlock) {
          result += '\n'
        }
        result += walk(child, true)
        isFirstBlock = false
      } else {
        result += walk(child, isFirstBlock)
        if (result.length > 0) isFirstBlock = false
      }
    })

    return result
  }, [])

  // 同步编辑器内容与 value
  useEffect(() => {
    if (!editorRef.current) return

    // 撤销/重做操作已经自己处理了编辑器更新，跳过
    if (isUndoRedoRef.current) {
      lastDomSyncValueRef.current = value
      return
    }

    // agents/mentions 变化会触发 renderEditorContent 的引用变化。助手执行中这些变化很频繁，
    // value 没变时不要重写 contentEditable，否则可能覆盖用户正在输入但尚未完成同步的 DOM。
    if (lastDomSyncValueRef.current === value) return
    lastDomSyncValueRef.current = value

    const currentText = getPlainText()

    // value 为空时清空编辑器
    if (value === '') {
      if (currentText !== '') {
        editorRef.current.innerHTML = ''
      }
      return
    }

    // value 与编辑器内容不一致时更新
    if (currentText !== value) {
      renderEditorContent(value, value.length)
    }
  }, [value, renderEditorContent, getPlainText])

  // 计算光标位置（用于下拉菜单定位）
  const getCaretCoordinates = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return 0

    const range = selection.getRangeAt(0).cloneRange()
    range.collapse(true)

    const rect = range.getClientRects()[0]
    const editorRect = editorRef.current.getBoundingClientRect()

    if (!rect) return 0

    return rect.left - editorRect.left
  }, [])

  // 选择提及
  const handleSelectMention = useCallback((agent: Agent) => {
    if (!editorRef.current) return

    const selection = window.getSelection()
    if (!selection) return

    // 找到 @ 的位置
    const plainText = getPlainText()
    const atPos = plainText.lastIndexOf('@', plainText.length)

    // 构建新文本
    const before = plainText.slice(0, atPos)
    const queryLength = mentionQuery.length
    const after = plainText.slice(atPos + 1 + queryLength)
    const newText = before + `@${agent.name} ` + after

    const newCursorPos = before.length + agent.name.length + 2
    pushHistory(newText, newCursorPos)
    onChange(newText)
    setShowMentions(false)
    setMentionQuery('')
    setSelectedIndex(0)

    // 设置光标位置
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.focus()
        renderEditorContent(newText, newCursorPos)
      }
    }, 0)
  }, [mentionQuery, onChange, getPlainText, pushHistory, renderEditorContent])

  const handleSelectSlashCommand = useCallback((item: SlashCommand) => {
    if (!editorRef.current) return

    const plainText = getPlainText()
    const selection = window.getSelection()
    const cursorOffset = selection?.rangeCount
      ? (() => {
          const range = selection.getRangeAt(0)
          const preRange = document.createRange()
          preRange.selectNodeContents(editorRef.current!)
          preRange.setEnd(range.startContainer, range.startOffset)
          return preRange.toString().length
        })()
      : plainText.length

    const slashPos = plainText.lastIndexOf('/', cursorOffset)
    const before = slashPos >= 0 ? plainText.slice(0, slashPos) : ''
    const after = slashPos >= 0 ? plainText.slice(slashPos + 1 + slashQuery.length) : ''
    const needsTrailingSpace = after.length > 0 && !after.startsWith(' ')
    const insertValue = item.insertText ?? item.command
    const inserted = `${insertValue}${after.length === 0 || needsTrailingSpace ? ' ' : ''}`
    const newText = before + inserted + after
    const newCursorPos = before.length + inserted.length

    pushHistory(newText, newCursorPos)
    onChange(newText)
    setShowSlashCommands(false)
    setSlashQuery('')
    setSelectedCommandIndex(0)

    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.focus()
        renderEditorContent(newText, newCursorPos)
      }
    }, 0)
  }, [getPlainText, onChange, pushHistory, renderEditorContent, slashQuery])

  // 删除整个 mention
  const deleteMention = useCallback((mentionId: string) => {
    const mention = mentions.find(m => m.id === mentionId)
    if (!mention) return

    const before = value.slice(0, mention.start)
    const after = value.slice(mention.end)
    const newValue = before + after
    pushHistory(newValue, mention.start)
    onChange(newValue)
  }, [value, mentions, onChange, pushHistory])

  // 输入事件处理
  const handleBeforeInput = useCallback((e: React.SyntheticEvent<HTMLDivElement>) => {
    const event = e.nativeEvent as InputEvent
    if (!editorRef.current) return

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    let cursorOffset = 0

    // 计算光标偏移量
    const preRange = document.createRange()
    preRange.selectNodeContents(editorRef.current)
    preRange.setEnd(range.startContainer, range.startOffset)
    cursorOffset = preRange.toString().length

    // 检查光标是否在 mention 内
    for (const mention of mentions) {
      if (cursorOffset > mention.start && cursorOffset < mention.end) {
        // 在 mention 内部，阻止输入
        event.preventDefault()
        // 移动光标到 mention 末尾
        const mentionNode = editorRef.current.querySelector(`[data-mention-id="${mention.id}"]`)
        if (mentionNode) {
          const newRange = document.createRange()
          newRange.selectNodeContents(mentionNode)
          newRange.collapse(false)
          selection.removeAllRanges()
          selection.addRange(newRange)
        }
        return
      }
    }

    // 检查输入内容
    if (event.inputType === 'insertText' && event.data) {
      // 检查是否在 mention 末尾且输入空格
      for (const mention of mentions) {
        if (cursorOffset === mention.end && event.data === ' ') {
          // 允许在 mention 后输入空格
          return
        }
      }
    }
  }, [mentions])

  // 键盘事件处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isComposingRef.current) return

    // 撤销 Ctrl+Z
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      const entry = undo()
      if (entry) {
        onChange(entry.value)
        // 使用公共函数更新编辑器
        setTimeout(() => {
          renderEditorContent(entry.value, entry.cursorOffset)
          isUndoRedoRef.current = false
        }, 0)
      }
      return
    }

    // 重做 Ctrl+Y 或 Ctrl+Shift+Z
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault()
      const entry = redo()
      if (entry) {
        onChange(entry.value)
        // 使用公共函数更新编辑器
        setTimeout(() => {
          renderEditorContent(entry.value, entry.cursorOffset)
          isUndoRedoRef.current = false
        }, 0)
      }
      return
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      onKeyDown?.(e)
      return
    }

    const range = selection.getRangeAt(0)
    let cursorOffset = 0

    // 计算光标偏移量
    if (editorRef.current) {
      const preRange = document.createRange()
      preRange.selectNodeContents(editorRef.current)
      preRange.setEnd(range.startContainer, range.startOffset)
      cursorOffset = preRange.toString().length
    }

    // Backspace 处理
    if (e.key === 'Backspace') {
      // 检查光标是否在 mention 内部或末尾
      for (const mention of mentions) {
        if (cursorOffset > mention.start && cursorOffset <= mention.end) {
          e.preventDefault()
          deleteMention(mention.id)
          return
        }
      }
    }

    // Delete 处理
    if (e.key === 'Delete') {
      for (const mention of mentions) {
        if (cursorOffset === mention.start) {
          e.preventDefault()
          deleteMention(mention.id)
          return
        }
      }
    }

    // 检查是否在 mention 内部，阻止其他按键
    for (const mention of mentions) {
      if (cursorOffset > mention.start && cursorOffset < mention.end) {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
          e.preventDefault()
          return
        }
      }
    }

    // 处理 slash command 选择下拉框
    if (showSlashCommands && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedCommandIndex(prev => Math.min(prev + 1, filteredCommands.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCommandIndex(prev => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        handleSelectSlashCommand(filteredCommands[selectedCommandIndex])
        return
      }
      if (e.key === 'Escape') {
        setShowSlashCommands(false)
        return
      }
    }

    // 处理 mention 选择下拉框
    if (showMentions && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filteredAgents.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        handleSelectMention(filteredAgents[selectedIndex])
        return
      }
      if (e.key === 'Escape') {
        setShowMentions(false)
        return
      }
    }

    onKeyDown?.(e)
  }, [mentions, showSlashCommands, filteredCommands, selectedCommandIndex, handleSelectSlashCommand, showMentions, filteredAgents, selectedIndex, handleSelectMention, onKeyDown, deleteMention, undo, redo, renderEditorContent])

  // 输入事件处理
  const handleInput = useCallback(() => {
    if (isComposingRef.current) return

    const plainText = getPlainText()

    // 检测 @ 提及
    const cursorOffset = window.getSelection()?.rangeCount
      ? (() => {
          const range = window.getSelection()!.getRangeAt(0)
          const preRange = document.createRange()
          preRange.selectNodeContents(editorRef.current!)
          preRange.setEnd(range.startContainer, range.startOffset)
          return preRange.toString().length
        })()
      : plainText.length

    const lastSlashIndex = plainText.lastIndexOf('/', cursorOffset)
    if (lastSlashIndex !== -1) {
      const query = plainText.slice(lastSlashIndex + 1, cursorOffset)
      const previousChar = lastSlashIndex > 0 ? plainText[lastSlashIndex - 1] : ''
      const startsCommand = lastSlashIndex === 0 || /\s/.test(previousChar)
      if (startsCommand && !query.includes(' ') && !query.includes('\n')) {
        const left = getCaretCoordinates()
        setSlashLeft(left)
        setShowSlashCommands(true)
        setSlashQuery(query)
        setSelectedCommandIndex(0)
        setShowMentions(false)
      } else {
        setShowSlashCommands(false)
      }
    } else {
      setShowSlashCommands(false)
    }

    const lastAtIndex = plainText.lastIndexOf('@', cursorOffset)
    if (lastAtIndex !== -1) {
      const query = plainText.slice(lastAtIndex + 1, cursorOffset)
      if (!query.includes(' ') && !mentions.some(m => lastAtIndex >= m.start && lastAtIndex < m.end)) {
        const left = getCaretCoordinates()
        setMentionLeft(left)
        setShowMentions(true)
        setMentionQuery(query)
        setSelectedIndex(0)
        setShowSlashCommands(false)
      } else {
        setShowMentions(false)
      }
    } else {
      setShowMentions(false)
    }

    pushHistory(plainText, cursorOffset)
    onChange(plainText)
  }, [getPlainText, getCaretCoordinates, mentions, onChange, pushHistory])

  // 中文输入法处理
  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true
  }, [])

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false
    handleInput()
  }, [handleInput])

  // 粘贴事件处理 - 只保留纯文本
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return

    const selection = window.getSelection()
    if (!selection || !editorRef.current) return

    // 删除选中内容
    if (!selection.isCollapsed && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      range.deleteContents()
    }

    // 插入纯文本
    document.execCommand('insertText', false, text)
  }, [])

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowMentions(false)
        setShowSlashCommands(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* 可编辑区域 */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onBeforeInput={handleBeforeInput}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onPaste={handlePaste}
        className="min-h-6 max-h-32 overflow-y-auto cursor-text whitespace-pre-wrap break-all text-foreground outline-none empty:before:text-[var(--placeholder-foreground)] empty:before:content-[attr(data-placeholder)]"
        data-placeholder={placeholder}
      />

      {/* Mention suggestions */}
      {showMentions && filteredAgents.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full z-20 mb-1 w-64 rounded-lg border border-border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200"
          style={{ left: `${mentionLeft}px` }}
        >
          {filteredAgents.map((agent, index) => (
            <div
              key={agent.id}
              ref={index === selectedIndex ? selectedItemRef : null}
              className={cn(
                'flex cursor-pointer items-center gap-2 px-3 py-2 first:rounded-t-lg last:rounded-b-lg hover:bg-primary/5',
                index === selectedIndex && 'bg-primary/5'
              )}
              onClick={() => handleSelectMention(agent)}
            >
              <AgentAvatarImage avatar={agent.avatar ?? null} className="size-6" />
              <span className="text-sm">{agent.name}</span>
              <Bot className="ml-auto size-3 text-primary" />
            </div>
          ))}
        </div>
      )}

      {/* Slash command suggestions */}
      {showSlashCommands && filteredCommands.length > 0 && (
        <div
          ref={commandDropdownRef}
          className="absolute bottom-full z-20 mb-1 w-80 rounded-lg border border-border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200"
          style={{ left: `${slashLeft}px` }}
        >
          {filteredCommands.map((item, index) => (
            <div
              key={`${item.command}-${index}`}
              ref={index === selectedCommandIndex ? selectedCommandRef : null}
              className={cn(
                'flex cursor-pointer items-center gap-3 px-3 py-2.5 first:rounded-t-lg last:rounded-b-lg hover:bg-blue-500/5',
                index === selectedCommandIndex && 'bg-blue-500/5'
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelectSlashCommand(item)}
            >
              <span className="inline-flex min-w-[6.75rem] shrink-0 whitespace-nowrap rounded-md bg-blue-500/10 px-2 py-0.5 font-mono text-xs font-medium text-blue-600">
                {item.command}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})