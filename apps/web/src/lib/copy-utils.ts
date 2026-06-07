/**
 * 兼容 Android WebView 的复制函数
 * Android WebView 可能不支持 navigator.clipboard.writeText
 */

/**
 * 复制文本到剪贴板
 * 优先使用现代 API，失败时回退到 execCommand
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 优先尝试现代 API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 失败，回退到 execCommand
    }
  }

  // 回退方案：使用 execCommand
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    textarea.setAttribute('readonly', '')
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    return success
  } catch {
    return false
  }
}