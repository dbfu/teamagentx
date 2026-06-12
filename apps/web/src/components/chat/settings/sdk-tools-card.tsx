import { acpToolsApi, type AcpToolInfo } from '@/lib/agent-api'
import { cn } from '@/lib/utils'
import { Download, Loader2, RefreshCw, Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

/**
 * ACP/SDK 工具检测与安装（仅桌面端）
 */
export function SdkToolsCard() {
  const { t } = useTranslation()
  const [acpTools, setAcpTools] = useState<AcpToolInfo[]>([])
  const [loadingAcpTools, setLoadingAcpTools] = useState(false)
  const [installingToolId, setInstallingToolId] = useState<string | null>(null)

  const refreshAcpTools = async () => {
    setLoadingAcpTools(true)
    try {
      const response = await acpToolsApi.getAll()
      if (response.success && response.data) {
        setAcpTools(response.data)
      } else {
        toast.error(t('toast.loadFailed'))
      }
    } finally {
      setLoadingAcpTools(false)
    }
  }

  useEffect(() => {
    refreshAcpTools()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleInstallAcpSdk = async (toolId: string) => {
    setInstallingToolId(toolId)
    try {
      const exitCode = await acpToolsApi.installTool(toolId, () => {})
      if (exitCode === 0) {
        toast.success(t('settings.sdkInstallSuccess'))
        await refreshAcpTools()
        return
      }
      toast.error(t('settings.sdkInstallFailed'))
    } catch (error: any) {
      toast.error(error.message || t('settings.sdkInstallError'))
    } finally {
      setInstallingToolId(null)
    }
  }

  const getRuntimeLabel = (tool: AcpToolInfo) => {
    if (tool.preferredRuntime === 'sdk') return t('settings.runtimeSdk')
    if (tool.preferredRuntime === 'cli') return t('settings.runtimeCli')
    return t('settings.runtimeUnavailable')
  }

  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-primary" />
          <h2 className="text-sm font-medium text-muted-foreground">{t('settings.acpToolsTitle')}</h2>
        </div>
        <button
          onClick={refreshAcpTools}
          disabled={loadingAcpTools || installingToolId !== null}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3.5', loadingAcpTools && 'animate-spin')} />
          {t('settings.redetect')}
        </button>
      </div>

      <div className="space-y-3">
        {acpTools.map((tool) => {
          const isInstalling = installingToolId === tool.id
          return (
            <div key={tool.id} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{tool.name}</span>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-xs',
                      tool.preferredRuntime === 'sdk'
                        ? 'bg-blue-500/10 text-blue-600'
                        : tool.preferredRuntime === 'cli'
                          ? 'bg-emerald-500/10 text-emerald-600'
                          : 'bg-muted text-muted-foreground'
                    )}>
                      {getRuntimeLabel(tool)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className={cn(tool.cliInstalled && 'text-emerald-600')}>
                      CLI: {tool.cliInstalled ? (tool.cliVersion || t('settings.cliDetected')) : t('settings.cliNotDetected')}
                    </span>
                    <span className={cn(tool.sdkInstalled && 'text-blue-600')}>
                      SDK: {tool.sdkInstalled ? (tool.sdkVersion || t('settings.sdkInstalled')) : t('settings.sdkNotInstalled')}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleInstallAcpSdk(tool.id)}
                  disabled={isInstalling || installingToolId !== null}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isInstalling ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      {t('settings.installing')}
                    </>
                  ) : tool.sdkInstalled ? (
                    <>
                      <Download className="size-3.5" />
                      {t('settings.reinstallSdk')}
                    </>
                  ) : (
                    <>
                      <Download className="size-3.5" />
                      {t('settings.installSdk')}
                    </>
                  )}
                </button>
              </div>
            </div>
          )
        })}

        {!loadingAcpTools && acpTools.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            {t('settings.noAcpTools')}
          </div>
        )}
      </div>

      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {t('settings.acpToolsHint')}
      </p>
    </div>
  )
}
