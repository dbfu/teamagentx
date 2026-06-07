import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadIcon } from './shared-components'
import { getResolvedDownloadHref, trackBaiduDownload, type DownloadPlatform } from './download-helper'
import type { SiteConfig } from './site-config'
import { useLanguage } from './i18n/context'

type DownloadVariant = 'desktop' | 'mobile'

interface DownloadButtonProps {
  siteConfig?: SiteConfig
  variant?: DownloadVariant
  className?: string
  label?: string
  iconSize?: number
}

const EMPTY_CONFIG: SiteConfig = {
  version: '', macUrlArm64: '', macUrlX64: '', winUrl: '', iosUrl: '', androidUrl: '',
}

interface PlatformOption {
  platform: DownloadPlatform
  url: string
  title: string
  desc: string
}

// header / 下载区下载按钮：点击弹出下载框（桌面端芯片选择 / 移动端）
export function DownloadButton({
  siteConfig,
  variant = 'desktop',
  className,
  label,
  iconSize = 13,
}: DownloadButtonProps) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<DownloadPlatform | ''>('')
  const [detected, setDetected] = useState<DownloadPlatform | ''>('')

  const cfg = siteConfig ?? EMPTY_CONFIG
  const isMobile = variant === 'mobile'

  // 弹框打开时锁定背景滚动
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // 检测当前设备，默认选中对应安装包
  useEffect(() => {
    const ua = navigator.userAgent
    if (/Macintosh/.test(ua)) {
      const uad = (navigator as { userAgentData?: { getHighEntropyValues: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData
      const resolve = (arch: DownloadPlatform) => { setDetected(arch); setSelected(arch) }
      if (uad?.getHighEntropyValues) {
        uad.getHighEntropyValues(['architecture'])
          .then((h) => resolve(h.architecture === 'arm' ? 'macos-arm64' : 'macos-x64'))
          .catch(() => resolve('macos-arm64'))
      } else {
        resolve('macos-arm64')
      }
    } else if (!/Android|iPhone|iPad/.test(ua)) {
      setDetected('windows'); setSelected('windows')
    }
  }, [])

  const desktopOptions: PlatformOption[] = [
    { platform: 'macos-arm64', url: cfg.macUrlArm64, title: t('download.macosArmTitle'), desc: t('download.macosArmDesc') },
    { platform: 'macos-x64', url: cfg.macUrlX64, title: t('download.macosIntelTitle'), desc: t('download.macosIntelDesc') },
    { platform: 'windows', url: cfg.winUrl, title: t('download.windowsTitle'), desc: t('download.windowsDesc') },
  ]
  const current = (selected || desktopOptions[0].platform) as DownloadPlatform
  const currentOption = desktopOptions.find((o) => o.platform === current) ?? desktopOptions[0]

  const btnClass = className ?? (isMobile ? 'btn btn-outline' : 'btn btn-primary')
  const btnLabel = label ?? (isMobile ? t('download.mobileBtn') : t('download.desktopBtn'))

  return (
    <>
      <button type="button" className={btnClass} onClick={() => setOpen(true)}>
        {downloadIcon(iconSize)} {btnLabel}
      </button>

      {open && createPortal(
        <div className="mac-modal-overlay" onClick={() => setOpen(false)}>
          <div className="mac-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mac-modal-close" onClick={() => setOpen(false)}>×</button>

            {isMobile ? (
              <>
                <div className="mac-modal-header">
                  <h3>{t('download.mobileTitle')}</h3>
                  <p>{t('download.mobileDesc')}</p>
                </div>
                <div className="mac-modal-options">
                  {cfg.androidUrl ? (
                    <a
                      className="mac-modal-option download-modal-option"
                      href={getResolvedDownloadHref(cfg.androidUrl, { platform: 'android', version: cfg.version })}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => { trackBaiduDownload('android'); setOpen(false) }}
                    >
                      <div className="mac-modal-option-body">
                        <div className="mac-modal-option-title">{t('download.androidTitle')}</div>
                        <div className="mac-modal-option-desc">{t('download.androidDesc')}</div>
                      </div>
                      <span className="download-modal-icon">{downloadIcon(16)}</span>
                    </a>
                  ) : (
                    <div className="mac-modal-option download-modal-option download-modal-soon">
                      <div className="mac-modal-option-body">
                        <div className="mac-modal-option-title">{t('download.androidTitle')}</div>
                        <div className="mac-modal-option-desc">{t('download.androidSoon')}</div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="mac-modal-header">
                  <h3>{t('download.desktopTitle')}</h3>
                  <p>{t('download.desktopDesc')}</p>
                </div>
                <div className="mac-modal-options">
                  {desktopOptions.map((opt) => (
                    <button
                      key={opt.platform}
                      type="button"
                      className={`mac-modal-option${current === opt.platform ? ' selected' : ''}`}
                      onClick={() => setSelected(opt.platform)}
                    >
                      <div className="mac-modal-option-body">
                        <div className="mac-modal-option-title">{opt.title}</div>
                        <div className="mac-modal-option-desc">{opt.desc}</div>
                      </div>
                      {detected === opt.platform && <span className="mac-modal-badge">{t('download.currentDevice')}</span>}
                    </button>
                  ))}
                </div>
                <a
                  href={getResolvedDownloadHref(currentOption.url, { platform: currentOption.platform, version: cfg.version })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary mac-modal-download-btn"
                  onClick={() => { trackBaiduDownload(currentOption.platform); setOpen(false) }}
                >
                  {downloadIcon(15)} {t('download.downloadVersion')} {currentOption.title} {t('download.versionSuffix')}
                </a>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
