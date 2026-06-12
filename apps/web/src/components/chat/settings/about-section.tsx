import { openExternalUrl, TEAMAGENTX_DOCS_URL, TEAMAGENTX_WEBSITE_URL } from '@/lib/site-links'
import { BookOpenText, Globe2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

/**
 * 帮助与反馈：官网与用户文档
 */
export function AboutSection() {
  const { t } = useTranslation()

  const handleOpenExternalLink = async (url: string, fallbackError: string) => {
    const result = await openExternalUrl(url)
    if (!result.success) {
      toast.error(result.error || fallbackError)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <BookOpenText className="size-4 text-primary" />
        <h2 className="text-sm font-medium text-muted-foreground">{t('settings.websiteAndDocs')}</h2>
      </div>
      <p className="mb-4 text-xs leading-5 text-muted-foreground">
        {t('settings.websiteAndDocsHint')}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          onClick={() => handleOpenExternalLink(TEAMAGENTX_WEBSITE_URL, t('settings.openWebsiteFailed'))}
          className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-accent"
        >
          <Globe2 className="size-4" />
          {t('settings.websiteHome')}
        </button>
        <button
          onClick={() => handleOpenExternalLink(TEAMAGENTX_DOCS_URL, t('settings.openDocsFailed'))}
          className="flex items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
        >
          <BookOpenText className="size-4" />
          {t('settings.userDocs')}
        </button>
      </div>
    </div>
  )
}
