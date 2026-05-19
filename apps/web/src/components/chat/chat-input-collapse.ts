export const INPUT_EXPAND_TEXT_LENGTH = 500
export const INPUT_EXPAND_LINE_COUNT = 8

export function isLargeInputContent(value: string) {
  if (value.length > INPUT_EXPAND_TEXT_LENGTH) return true

  const lineCount = value.split(/\r\n|\r|\n/).length
  return lineCount > INPUT_EXPAND_LINE_COUNT
}
