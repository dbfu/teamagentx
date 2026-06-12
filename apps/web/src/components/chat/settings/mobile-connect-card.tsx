import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores'
import { ExternalLink, RefreshCw, Smartphone, VolumeX, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { QRCodeDisplay } from './qr-code-display'
import {
  buildQrLoginUrl,
  getBrowserApiServerUrl,
  getLocalNetworkIp,
  getUrlHostname,
  isLoopbackHost,
  replaceUrlHostname,
} from './qr-login-utils'

/**
 * 移动端连接与网页访问（共享局域网地址状态）
 */
export function MobileConnectCard() {
  const { t } = useTranslation()
  const { user, token } = useAuthStore()
  const [mobileWebUrl, setMobileWebUrl] = useState<string | null>(null)
  const [customServerUrl, setCustomServerUrl] = useState<string>('')
  const [generatedQRData, setGeneratedQRData] = useState<{ serverUrl: string; qrUrl: string } | null>(null)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showQRConfirmModal, setShowQRConfirmModal] = useState(false)
  const [localNetworkIps, setLocalNetworkIps] = useState<string[]>([])
  const [selectedLocalIp, setSelectedLocalIp] = useState<string>('')
  const [refreshingIps, setRefreshingIps] = useState(false)

  // 获取局域网地址
  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      window.electronAPI.getMobileWebUrl().then((url) => {
        setMobileWebUrl(url)
        // 默认使用局域网地址
        setCustomServerUrl(url || '')
        refreshLocalIps(url)
      })
    } else if (window.location.protocol.startsWith('http')) {
      if (isLoopbackHost(window.location.hostname)) {
        refreshLocalIps()
      } else {
        setCustomServerUrl(window.location.origin)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshLocalIps = async (mobileUrlOverride?: string | null) => {
    setRefreshingIps(true)
    try {
      if (window.electronAPI?.isElectron) {
        // Electron 通过内嵌后端 API 获取
        const effectiveMobileWebUrl = mobileUrlOverride ?? mobileWebUrl
        const apiUrl = effectiveMobileWebUrl || `http://localhost:11053`
        const apiServerUrl = getBrowserApiServerUrl(apiUrl)
        const response = await fetch(`${apiServerUrl}/network-info`)
        const data = await response.json() as { localIp?: string | null; localIps?: string[] }
        const localIps = data.localIps || (data.localIp ? [data.localIp] : [])
        setLocalNetworkIps(localIps)
        if (localIps.length > 0 && !selectedLocalIp) {
          const mobileUrlHost = getUrlHostname(effectiveMobileWebUrl)
          const defaultIp = mobileUrlHost && localIps.includes(mobileUrlHost)
            ? mobileUrlHost
            : data.localIp || localIps[0]
          setSelectedLocalIp(defaultIp)
          // 更新 customServerUrl 使用局域网 IP
          if (effectiveMobileWebUrl) {
            const parsed = new URL(effectiveMobileWebUrl)
            parsed.hostname = defaultIp
            setCustomServerUrl(parsed.toString().replace(/\/+$/, ''))
          }
        }
      } else {
        const { localIp, localIps } = await getLocalNetworkIp()
        setLocalNetworkIps(localIps)
        if (!selectedLocalIp) {
          setSelectedLocalIp(localIp || '')
          setCustomServerUrl(localIp ? replaceUrlHostname(window.location.origin, localIp) : window.location.origin)
        }
      }
    } catch {
      // ignore
    } finally {
      setRefreshingIps(false)
    }
  }

  // 二维码数据使用的服务器地址
  const qrServerUrl = customServerUrl || mobileWebUrl || ''
  const qrApiServerUrl = window.electronAPI?.isElectron ? qrServerUrl : getBrowserApiServerUrl(qrServerUrl)
  const canShowMobileConnect = Boolean(qrServerUrl && token && user)

  // 本地地址（用于打开网页按钮）
  const localServerUrl = mobileWebUrl ? (() => {
    const parsed = new URL(mobileWebUrl)
    parsed.hostname = '127.0.0.1'
    return parsed.toString().replace(/\/+$/, '')
  })() : null

  // 生成二维码
  const handleGenerateQRCode = () => {
    if (!qrServerUrl || !token || !user) {
      toast.error(t('settings.inputServerAddress'))
      return
    }
    try {
      setGeneratedQRData(buildQrLoginUrl(qrServerUrl, token, user.username, qrApiServerUrl))
    } catch {
      toast.error(t('settings.invalidServerAddress'))
    }
  }

  const handleLocalIpChange = (localIp: string) => {
    setSelectedLocalIp(localIp)
    if (window.electronAPI?.isElectron && mobileWebUrl) {
      const parsed = new URL(mobileWebUrl)
      parsed.hostname = localIp
      setCustomServerUrl(parsed.toString().replace(/\/+$/, ''))
    } else {
      setCustomServerUrl(replaceUrlHostname(window.location.origin, localIp))
    }
    setGeneratedQRData(null)
  }

  return (
    <>
      {/* 移动端连接 */}
      {canShowMobileConnect && (
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="w-full flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t('settings.mobileConnect')}</span>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-3">
              {t('settings.scanToConnectHint')}
            </p>

            {/* 局域网地址选择 + 刷新 */}
            {localNetworkIps.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium">{t('settings.localNetworkIp')}</label>
                  <button
                    onClick={() => refreshLocalIps()}
                    disabled={refreshingIps}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <RefreshCw className={cn('size-3', refreshingIps && 'animate-spin')} />
                    {t('settings.refreshIp')}
                  </button>
                </div>
                {localNetworkIps.length > 1 ? (
                  <Select
                    value={selectedLocalIp}
                    onValueChange={handleLocalIpChange}
                  >
                    <SelectTrigger className="w-full rounded-lg border-border bg-background">
                      <SelectValue placeholder={t('settings.selectLocalNetworkIp')} />
                    </SelectTrigger>
                    <SelectContent>
                      {localNetworkIps.map((ip) => (
                        <SelectItem key={ip} value={ip}>
                          {ip}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                    {localNetworkIps[0]}
                  </div>
                )}
              </div>
            )}

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium">{t('settings.serverAddress')}</label>
              <input
                type="text"
                value={customServerUrl}
                onChange={(e) => setCustomServerUrl(e.target.value)}
                placeholder={t('settings.serverAddressPlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('settings.serverAddressHint')}
              </p>
            </div>

            {/* 生成二维码按钮 */}
            <button
              onClick={() => setShowQRConfirmModal(true)}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              {t('settings.generateQR')}
            </button>
          </div>
        </div>
      )}

      {/* 网页访问 */}
      {window.electronAPI?.isElectron && localServerUrl && token && user && (
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-center gap-2">
            <ExternalLink className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('settings.webAccess')}</span>
          </div>
          <button
            onClick={() => {
              // 构建带登录参数的 URL
              const loginUrl = buildQrLoginUrl(localServerUrl, token, user.username)
              window.electronAPI?.openExternal(loginUrl.qrUrl)
                .then((result) => {
                  if (!result?.success) {
                    toast.error(t('settings.openWebFailed'))
                  }
                })
                .catch(() => {
                  toast.error(t('settings.openWebFailed'))
                })
            }}
            className="w-full rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-accent"
          >
            <span className="flex items-center justify-center gap-2">
              <ExternalLink className="size-4" />
              {t('settings.openWeb')}
            </span>
          </button>
        </div>
      )}

      {/* 二维码安全提示弹框 */}
      {showQRConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-[480px] rounded-2xl bg-card shadow-xl p-8">
            <div className="flex items-center justify-center mb-5">
              <div className="rounded-full bg-orange-100 p-4">
                <VolumeX className="size-7 text-orange-600" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-foreground text-center mb-3">{t('settings.securityAlert')}</h3>
            <p className="text-sm text-muted-foreground text-center leading-relaxed mb-8">
              {t('settings.securityAlertHint')}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowQRConfirmModal(false)}
                className="flex-1 rounded-lg border border-gray-200 text-gray-600 px-4 py-2.5 text-sm hover:bg-gray-50 whitespace-nowrap"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  handleGenerateQRCode()
                  setShowQRConfirmModal(false)
                  setShowQRModal(true)
                }}
                className="flex-1 rounded-lg bg-blue-500 px-4 py-2.5 text-sm text-white hover:bg-blue-600 whitespace-nowrap"
              >
                {t('settings.iUnderstand')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 二维码弹框 */}
      {showQRModal && generatedQRData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-[480px] rounded-2xl bg-card shadow-xl p-8">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-semibold text-foreground">{t('settings.scanToConnect')}</h3>
              <button
                onClick={() => setShowQRModal(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              {t('settings.scanToConnectHint')}
            </p>
            <QRCodeDisplay data={generatedQRData} />
          </div>
        </div>
      )}
    </>
  )
}
