import { Minus, Square, X, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

export function WindowTitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const [platform, setPlatform] = useState<'darwin' | 'win32' | 'linux'>('darwin')

  // 检测平台 - 从 electronAPI 获取真实平台信息
  useEffect(() => {
    if (window.electronAPI?.isElectron && window.electronAPI?.platform) {
      setPlatform(window.electronAPI.platform)
    }
  }, [])

  // 检查窗口是否最大化
  useEffect(() => {
    if (window.electronAPI?.windowIsMaximized) {
      window.electronAPI.windowIsMaximized().then((maximized) => {
        setIsMaximized(maximized)
      })
    }
  }, [])

  const handleMinimize = async () => {
    await window.electronAPI?.windowMinimize?.()
  }

  const handleMaximize = async () => {
    await window.electronAPI?.windowMaximize?.()
    const maximized = await window.electronAPI?.windowIsMaximized?.()
    setIsMaximized(maximized ?? false)
  }

  const handleClose = async () => {
    await window.electronAPI?.windowClose?.()
  }

  // macOS 不需要显示自定义标题栏
  if (platform === 'darwin') {
    return null
  }

  return (
    <div
      className="h-8 flex items-center justify-between bg-background border-b border-border select-none"
      style={{
        // Electron 无边框窗口的拖拽区域
        WebkitAppRegion: 'drag'
      } as React.CSSProperties}
    >
      {/* 左侧：应用标题 */}
      <div className="flex items-center gap-2 pl-3">
        <span className="text-sm font-medium text-foreground">TeamAgentX</span>
      </div>

      {/* 右侧：窗口控制按钮 */}
      <div
        className="flex items-center"
        style={{
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}
      >
        {/* 最小化按钮 */}
        <button
          onClick={handleMinimize}
          className="h-8 w-12 flex items-center justify-center hover:bg-muted/50 transition-colors"
          title="最小化"
        >
          <Minus className="h-4 w-4 text-muted-foreground" />
        </button>

        {/* 最大化/还原按钮 */}
        <button
          onClick={handleMaximize}
          className="h-8 w-12 flex items-center justify-center hover:bg-muted/50 transition-colors"
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Square className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {/* 关闭按钮 */}
        <button
          onClick={handleClose}
          className="h-8 w-12 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}