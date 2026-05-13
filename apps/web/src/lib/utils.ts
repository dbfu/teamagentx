import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatToolName(name?: string | null, fallback = '工具调用'): string {
  if (typeof name !== 'string') return fallback

  let normalized = name.trim()
  if (!normalized) return fallback

  const first = normalized[0]
  const last = normalized[normalized.length - 1]
  const hasMatchingQuotes =
    normalized.length >= 2 &&
    ((first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '`' && last === '`'))

  if (hasMatchingQuotes) {
    if (first === '"') {
      try {
        const parsed = JSON.parse(normalized)
        if (typeof parsed === 'string') {
          normalized = parsed.trim()
        }
      } catch {
        normalized = normalized.slice(1, -1).trim()
      }
    } else {
      normalized = normalized.slice(1, -1).trim()
    }
  }

  const lower = normalized.toLowerCase()
  if (
    !normalized ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'unknown' ||
    lower === 'tool call' ||
    lower === 'tool_call'
  ) {
    return fallback
  }

  return normalized
}

export function truncateToolName(name?: string | null, fallback = '工具调用'): string {
  const formatted = formatToolName(name, fallback)
  const spaceIndex = formatted.indexOf(' ')
  return spaceIndex > 0 ? formatted.slice(0, spaceIndex) : formatted
}

/**
 * 格式化日期时间显示
 * - 当天：时:分 (如 15:30)
 * - 昨天：时:分 (如 20:30)
 * - 同年：x月x日 时:分 (如 4月14日 15:30)
 * - 不同年：xxxx年x月x日 时:分 (如 2025年4月14日 15:30)
 */
export function formatDateTime(dateStr: string | Date): string {
  const date = dayjs(dateStr)
  const now = dayjs()
  const timeStr = date.format('HH:mm')

  // 判断是否当天或昨天（只显示时间，不显示日期前缀）
  if (date.isSame(now, 'day') || date.isSame(now.subtract(1, 'day'), 'day')) {
    return timeStr
  }

  // 判断是否同年
  if (date.isSame(now, 'year')) {
    return `${date.format('M月D日')} ${timeStr}`
  }

  // 不同年
  return `${date.format('YYYY年M月D日')} ${timeStr}`
}

/**
 * 格式化相对时间显示
 * - 1分钟内：刚刚
 * - 1小时内：x分钟前
 * - 24小时内：x小时前
 * - 7天内：x天前
 * - 其他：formatDateTime
 */
export function formatRelativeTime(dateStr: string | Date): string {
  const date = dayjs(dateStr)
  const now = dayjs()
  const diffMinutes = now.diff(date, 'minute')
  const diffHours = now.diff(date, 'hour')
  const diffDays = now.diff(date, 'day')

  if (diffMinutes < 1) {
    return '刚刚'
  }

  if (diffHours < 1) {
    return `${diffMinutes}分钟前`
  }

  if (diffDays < 1) {
    return `${diffHours}小时前`
  }

  if (diffDays < 7) {
    return `${diffDays}天前`
  }

  return formatDateTime(dateStr)
}
