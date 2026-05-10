import { toPng } from 'html-to-image'

/**
 * 预加载容器中的所有图片
 * 用于截图前确保所有图片都已加载完成
 */
export async function preloadImages(container: HTMLElement): Promise<void> {
  const images = container.querySelectorAll('img[src]')
  const loadPromises = Array.from(images).map(img => {
    const imgEl = img as HTMLImageElement
    // 图片已加载完成
    if (imgEl.complete && imgEl.naturalHeight !== 0) {
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      imgEl.onload = () => resolve()
      imgEl.onerror = () => {
        // 图片加载失败时使用占位图或继续
        resolve()
      }
      // 强制触发加载
      const originalSrc = imgEl.src
      if (originalSrc) {
        imgEl.src = ''
        imgEl.src = originalSrc
      }
    })
  })
  await Promise.all(loadPromises)
}

/**
 * 将 DOM 元素转换为图片（PNG 格式）
 */
export async function elementToImage(
  element: HTMLElement,
  options: {
    quality?: number
    backgroundColor?: string
    pixelRatio?: number
  } = {}
): Promise<string> {
  const { quality = 0.9, backgroundColor = '#ffffff', pixelRatio = 2 } = options

  try {
    // 预加载图片
    await preloadImages(element)

    // 等待足够长的时间确保所有样式渲染完成
    await new Promise(resolve => requestAnimationFrame(resolve))
    await new Promise(resolve => requestAnimationFrame(resolve))
    // 额外等待 200ms 确保布局完成
    await new Promise(resolve => setTimeout(resolve, 200))

    const dataUrl = await toPng(element, {
      quality,
      backgroundColor,
      pixelRatio,
      cacheBust: true,
      // 不使用 credentials: include，避免 Google Fonts CORS 问题
      // 字体已经在浏览器中渲染完成，html-to-image 会克隆当前 DOM 状态
      style: {
        // 确保使用正确的字体，避免回退字体导致布局变化
        fontFamily: "'Geist', 'Geist Mono Fallback', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        // 覆盖容器的 opacity: 0，确保能捕获
        opacity: '1',
      },
    })

    return dataUrl
  } catch (err) {
    throw err
  }
}

/**
 * 下载图片文件
 */
export function downloadImage(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  link.target = '_blank'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * 复制图片到剪贴板
 */
export async function copyImageToClipboard(dataUrl: string): Promise<boolean> {
  try {
    // 将 dataUrl 转换为 blob
    const response = await fetch(dataUrl)
    const blob = await response.blob()

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ])
    return true
  } catch {
    return false
  }
}

/**
 * 生成截图文件名
 * 格式：{群名称}_聊天记录_{日期}_{时间}.png
 */
export function generateScreenshotFilename(roomName: string): string {
  const date = new Date()
  const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
  const timeStr = `${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}`
  return `${roomName}_聊天记录_${dateStr}_${timeStr}.png`
}