import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'

interface ChatEmptyAgentHintProps {
  // 群助手名称（用于展示可点击的 @ 提及）
  groupAssistantName: string
  // 点击 @群助手 时把提及写入输入框
  onMentionGroupAssistant: () => void
}

// 新建群聊未选择任何助手时，在群聊中心展示的引导提示：
// 引导用户在输入框 @群助手 让它帮忙创建助手。
export function ChatEmptyAgentHint({ groupAssistantName, onMentionGroupAssistant }: ChatEmptyAgentHintProps) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full select-none items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-500 dark:bg-blue-950/40">
          <Bot className="size-7" />
        </div>
        <h3 className="mb-1.5 text-base font-medium text-foreground">
          {t('chat.noAgentHintTitle')}
        </h3>
        <p className="text-sm leading-relaxed text-gray-500 dark:text-muted-foreground">
          {t('chat.noAgentHintDescPrefix')}
          <button
            type="button"
            onClick={onMentionGroupAssistant}
            className="mx-1 inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 font-medium text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"
          >
            @{groupAssistantName}
          </button>
          {t('chat.noAgentHintDescSuffix')}
        </p>
        <p className="mt-2 text-xs text-gray-400 dark:text-muted-foreground/70">
          {t('chat.noAgentHintExample', { name: groupAssistantName })}
        </p>
      </div>
    </div>
  )
}
