// 后端提示词 / 系统消息国际化共享的 locale 工具。
// 后端没有完整 i18n 框架，统一用这里的 Locale 类型与归一化函数，
// 让「系统注入文案」与「Agent 系统提示词」按用户界面语言切换中英文。

export type Locale = 'zh-CN' | 'en-US';

export const DEFAULT_LOCALE: Locale = 'zh-CN';

/**
 * 容忍 'en'、'en-US'、'en_US'、'zh'、'zh-CN' 等写法，归一化为受支持的 Locale。
 * 非英文一律落到默认中文。
 */
export function normalizeLocale(locale?: string | null): Locale {
  if (!locale) return DEFAULT_LOCALE;
  if (locale.toLowerCase().startsWith('en')) return 'en-US';
  return 'zh-CN';
}

/**
 * 按 locale 从中英文案对里取值，缺失时回退默认中文。
 */
export function pickLocaleText(
  entry: Record<Locale, string>,
  locale?: string | null,
): string {
  return entry[normalizeLocale(locale)] ?? entry[DEFAULT_LOCALE];
}
