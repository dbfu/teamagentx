import { toPng } from 'html-to-image'

export const SCREENSHOT_EXPORT_WIDTH = 560
export const SCREENSHOT_PIXEL_RATIO = 3
export const SCREENSHOT_IMAGE_PAGE_THRESHOLD = 5
const SCREENSHOT_MAX_LAYOUT_WIDTH = 1000
const SCREENSHOT_MAX_CANVAS_HEIGHT = 16000
const SCREENSHOT_SEGMENT_CANVAS_HEIGHT = 12000
const SCREENSHOT_PAGE_ITEM_SELECTOR = '[data-screenshot-page-item="true"]'

interface ScreenshotPageRange {
  offsetTop: number
  height: number
}

function waitForPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

async function fitScreenshotElementToCanvasLimit(
  element: HTMLElement,
  preferredPixelRatio: number
): Promise<{ pixelRatio: number; restore: () => void }> {
  const originalWidth = element.style.width
  const currentWidth = element.getBoundingClientRect().width || SCREENSHOT_EXPORT_WIDTH
  const currentHeight = element.scrollHeight || element.getBoundingClientRect().height

  if (currentHeight * preferredPixelRatio <= SCREENSHOT_MAX_CANVAS_HEIGHT) {
    return { pixelRatio: preferredPixelRatio, restore: () => {} }
  }

  const targetWidth = Math.min(
    SCREENSHOT_MAX_LAYOUT_WIDTH,
    Math.max(currentWidth, Math.ceil((currentWidth * currentHeight * preferredPixelRatio) / SCREENSHOT_MAX_CANVAS_HEIGHT))
  )

  if (targetWidth > currentWidth) {
    element.style.width = `${targetWidth}px`
    await waitForPaint()
  }

  const fittedHeight = element.scrollHeight || element.getBoundingClientRect().height
  const fittedPixelRatio = Math.min(preferredPixelRatio, SCREENSHOT_MAX_CANVAS_HEIGHT / Math.max(1, fittedHeight))

  return {
    pixelRatio: Math.max(0.1, fittedPixelRatio),
    restore: () => {
      element.style.width = originalWidth
    },
  }
}

function createScreenshotSliceElement(
  element: HTMLElement,
  offsetTop: number,
  height: number,
  width: number,
  backgroundColor: string
): { hostElement: HTMLElement; sliceElement: HTMLElement } {
  const hostElement = document.createElement('div')
  hostElement.style.position = 'fixed'
  hostElement.style.left = '-10000px'
  hostElement.style.top = '0'
  hostElement.style.width = `${width}px`
  hostElement.style.height = `${height}px`
  hostElement.style.pointerEvents = 'none'
  hostElement.style.zIndex = '9999'

  const sliceElement = document.createElement('div')
  sliceElement.style.position = 'relative'
  sliceElement.style.width = `${width}px`
  sliceElement.style.height = `${height}px`
  sliceElement.style.overflow = 'hidden'
  sliceElement.style.backgroundColor = backgroundColor
  sliceElement.style.pointerEvents = 'none'

  const clone = element.cloneNode(true) as HTMLElement
  clone.style.position = 'relative'
  clone.style.top = '0'
  clone.style.left = '0'
  clone.style.width = `${width}px`
  clone.style.maxWidth = 'none'
  clone.style.opacity = '1'
  clone.style.pointerEvents = 'none'
  clone.style.transform = `translateY(-${offsetTop}px)`
  clone.style.transformOrigin = 'top left'

  sliceElement.appendChild(clone)
  hostElement.appendChild(sliceElement)
  return { hostElement, sliceElement }
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return new File([blob], filename, { type: blob.type || 'image/png' })
}

function getFixedHeightPageRanges(totalHeight: number, segmentHeight: number): ScreenshotPageRange[] {
  const ranges: ScreenshotPageRange[] = []

  for (let offsetTop = 0; offsetTop < totalHeight; offsetTop += segmentHeight) {
    ranges.push({
      offsetTop,
      height: Math.min(segmentHeight, totalHeight - offsetTop),
    })
  }

  return ranges
}

function getRelativeBounds(root: HTMLElement, element: HTMLElement): { top: number; bottom: number } {
  const rootRect = root.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()

  return {
    top: Math.max(0, Math.floor(elementRect.top - rootRect.top)),
    bottom: Math.max(0, Math.ceil(elementRect.bottom - rootRect.top)),
  }
}

function getMessageAwarePageRanges(element: HTMLElement, segmentHeight: number): ScreenshotPageRange[] {
  const totalHeight = Math.ceil(element.scrollHeight || element.getBoundingClientRect().height)
  const pageItems = Array.from(element.querySelectorAll<HTMLElement>(SCREENSHOT_PAGE_ITEM_SELECTOR))

  if (pageItems.length === 0) {
    return getFixedHeightPageRanges(totalHeight, segmentHeight)
  }

  const ranges: ScreenshotPageRange[] = []
  let pageStart = 0
  let pageEnd = 0

  for (const item of pageItems) {
    const { top, bottom } = getRelativeBounds(element, item)
    if (bottom <= pageStart) {
      continue
    }

    if (bottom - pageStart <= segmentHeight) {
      pageEnd = Math.max(pageEnd, bottom)
      continue
    }

    if (pageEnd > pageStart && top > pageStart) {
      ranges.push({
        offsetTop: pageStart,
        height: Math.min(segmentHeight, top - pageStart),
      })
      pageStart = top
      pageEnd = top
    }

    if (bottom - pageStart <= segmentHeight) {
      pageEnd = Math.max(pageEnd, bottom)
      continue
    }

    ranges.push({
      offsetTop: pageStart,
      height: Math.min(segmentHeight, totalHeight - pageStart),
    })
    pageStart = bottom
    pageEnd = bottom
  }

  if (pageStart < totalHeight && pageEnd > pageStart) {
    if (totalHeight - pageStart <= segmentHeight) {
      ranges.push({
        offsetTop: pageStart,
        height: totalHeight - pageStart,
      })
    } else {
      ranges.push(...getFixedHeightPageRanges(totalHeight - pageStart, segmentHeight).map(range => ({
        offsetTop: pageStart + range.offsetTop,
        height: range.height,
      })))
    }
  }

  return ranges.filter(range => range.height > 0)
}

export function shouldMergeScreenshotOnServer(
  element: HTMLElement,
  pixelRatio = SCREENSHOT_PIXEL_RATIO
): boolean {
  const height = element.scrollHeight || element.getBoundingClientRect().height
  return height * pixelRatio > SCREENSHOT_MAX_CANVAS_HEIGHT
}

export function estimateScreenshotImagePageCount(
  element: HTMLElement,
  pixelRatio = SCREENSHOT_PIXEL_RATIO
): number {
  const height = element.scrollHeight || element.getBoundingClientRect().height
  const segmentHeight = Math.max(1, Math.floor(SCREENSHOT_SEGMENT_CANVAS_HEIGHT / pixelRatio))
  return Math.max(1, Math.ceil(height / segmentHeight))
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function collectPrintStyles(): string {
  return Array.from(document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style'))
    .map(node => node.outerHTML)
    .join('\n')
}

function waitForPrintLink(link: HTMLLinkElement): Promise<void> {
  return new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }

    try {
      if (link.sheet) {
        finish()
        return
      }
    } catch {
      // Some stylesheet objects are not readable across document contexts.
    }

    link.addEventListener('load', finish, { once: true })
    link.addEventListener('error', finish, { once: true })
    setTimeout(finish, 1500)
  })
}

function waitForPrintImage(image: HTMLImageElement): Promise<void> {
  return new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }

    if (image.complete) {
      finish()
      return
    }

    image.addEventListener('load', finish, { once: true })
    image.addEventListener('error', finish, { once: true })
    setTimeout(finish, 1500)
  })
}

function buildPrintableElementHtml(element: HTMLElement, filename: string): string {
  const clone = element.cloneNode(true) as HTMLElement
  clone.style.position = 'static'
  clone.style.top = 'auto'
  clone.style.left = 'auto'
  clone.style.width = '100%'
  clone.style.maxWidth = 'none'
  clone.style.opacity = '1'
  clone.style.pointerEvents = 'auto'
  clone.style.zIndex = 'auto'
  clone.style.margin = '0 auto'
  clone.style.transform = 'none'

  const printCss = `
    <style>
      @page { size: A4; margin: 12mm; }
      html, body { margin: 0; background: #ffffff; }
      body { color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-root { width: 100%; }
      .screenshot-container { position: static !important; width: 100% !important; max-width: none !important; opacity: 1 !important; pointer-events: auto !important; z-index: auto !important; }
      [data-screenshot-page-item="true"] { break-inside: auto !important; page-break-inside: auto !important; }
      img { max-width: 100%; }
      .screenshot-container img.rounded-lg {
        width: auto !important;
        height: auto !important;
        max-width: min(100%, 520px) !important;
        max-height: 360px !important;
        object-fit: contain !important;
      }
      pre, code { white-space: pre-wrap; word-break: break-word; }
    </style>
  `

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <base href="${escapeHtml(document.baseURI)}" />
        <title>${escapeHtml(filename)}</title>
        ${collectPrintStyles()}
        ${printCss}
      </head>
      <body>
        <main class="print-root">${clone.outerHTML}</main>
      </body>
    </html>
  `
}

export async function printElementAsPdf(element: HTMLElement, filename: string): Promise<{ method: 'electron' | 'browser'; filePath?: string; canceled?: boolean }> {
  const html = buildPrintableElementHtml(element, filename)

  if (window.electronAPI?.isElectron && window.electronAPI.exportPdf) {
    const result = await window.electronAPI.exportPdf({ html, filename })
    if (!result.success) {
      if (result.canceled) {
        return { method: 'electron', canceled: true }
      }
      throw new Error(result.error || '导出 PDF 失败')
    }

    return { method: 'electron', filePath: result.filePath }
  }

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  iframe.style.pointerEvents = 'none'
  document.body.appendChild(iframe)

  const printWindow = iframe.contentWindow
  const printDocument = iframe.contentDocument
  if (!printWindow || !printDocument) {
    document.body.removeChild(iframe)
    throw new Error('无法创建 PDF 打印视图')
  }

  printDocument.open()
  printDocument.write(html)
  printDocument.close()

  const links = Array.from(printDocument.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
  const images = Array.from(printDocument.images)
  await Promise.all([
    ...links.map(waitForPrintLink),
    ...images.map(waitForPrintImage),
  ])

  await new Promise(resolve => setTimeout(resolve, 100))

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) {
        document.body.removeChild(iframe)
      }
    }, 500)
  }

  printWindow.addEventListener('afterprint', cleanup, { once: true })
  setTimeout(cleanup, 5000)
  printWindow.focus()
  printWindow.print()
  return { method: 'browser' }
}

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

  let restoreLayout: (() => void) | null = null

  try {
    const fitted = await fitScreenshotElementToCanvasLimit(element, pixelRatio)
    restoreLayout = fitted.restore

    // 预加载图片
    await preloadImages(element)

    // 等待足够长的时间确保所有样式渲染完成
    await waitForPaint()
    // 额外等待 200ms 确保布局完成
    await new Promise(resolve => setTimeout(resolve, 200))

    const dataUrl = await toPng(element, {
      quality,
      backgroundColor,
      pixelRatio: fitted.pixelRatio,
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
  } finally {
    restoreLayout?.()
  }
}

/**
 * 将超长 DOM 分段转换为多张 PNG
 */
export async function elementToImageSegments(
  element: HTMLElement,
  options: {
    quality?: number
    backgroundColor?: string
    pixelRatio?: number
  } = {}
): Promise<File[]> {
  const { quality = 0.95, backgroundColor = '#ffffff', pixelRatio = SCREENSHOT_PIXEL_RATIO } = options

  try {
    await preloadImages(element)
    await waitForPaint()
    await new Promise(resolve => setTimeout(resolve, 200))

    const width = Math.ceil(element.getBoundingClientRect().width || SCREENSHOT_EXPORT_WIDTH)
    const segmentHeight = Math.max(1, Math.floor(SCREENSHOT_SEGMENT_CANVAS_HEIGHT / pixelRatio))
    const pageRanges = getMessageAwarePageRanges(element, segmentHeight)
    const files: File[] = []

    for (const [index, range] of pageRanges.entries()) {
      const { offsetTop, height } = range
      const { hostElement, sliceElement } = createScreenshotSliceElement(element, offsetTop, height, width, backgroundColor)
      document.body.appendChild(hostElement)

      try {
        await waitForPaint()
        const dataUrl = await toPng(sliceElement, {
          quality,
          backgroundColor,
          width,
          height,
          pixelRatio,
          cacheBust: true,
          style: {
            fontFamily: "'Geist', 'Geist Mono Fallback', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            opacity: '1',
          },
        })
        files.push(await dataUrlToFile(dataUrl, `screenshot-segment-${index + 1}.png`))
      } finally {
        document.body.removeChild(hostElement)
      }
    }

    return files
  } catch (err) {
    throw err
  }
}

/**
 * 下载图片文件
 */
export async function downloadImage(dataUrl: string, filename: string): Promise<void> {
  let href = dataUrl

  if (!dataUrl.startsWith('data:')) {
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    href = URL.createObjectURL(blob)
  }

  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.target = '_blank'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  if (href !== dataUrl) {
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  }
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
