import { visit } from 'unist-util-visit'

const URL_BREAK_PUNCTUATION_RE = /[，。！？；：、…]|[,.!?;:](?=[\u3400-\u9fff])/u
const TRAILING_URL_PUNCTUATION_RE = /[，。！？；：、,.!?;:…]+$/u

export function trimTrailingUrlPunctuation(value: string): { url: string; trailing: string } {
  const breakMatch = URL_BREAK_PUNCTUATION_RE.exec(value)
  if (breakMatch && breakMatch.index > 0) {
    return {
      url: value.slice(0, breakMatch.index),
      trailing: value.slice(breakMatch.index),
    }
  }

  const match = value.match(TRAILING_URL_PUNCTUATION_RE)
  if (!match) return { url: value, trailing: '' }

  return {
    url: value.slice(0, -match[0].length),
    trailing: match[0],
  }
}

function removeTrailingText(children: any[] | undefined, trailing: string): string {
  if (!children?.length || !trailing) return ''

  for (let i = children.length - 1; i >= 0; i -= 1) {
    const child = children[i]

    if (child.type === 'text') {
      if (!child.value.endsWith(trailing)) return ''

      child.value = child.value.slice(0, -trailing.length)
      if (!child.value) {
        children.splice(i, 1)
      }
      return trailing
    }

    const removed = removeTrailingText(child.children, trailing)
    if (removed) return removed
  }

  return ''
}

export function remarkTrimUrlPunctuation() {
  return (tree: any) => {
    visit(tree, 'link', (node: any, index: number | undefined, parent: any) => {
      if (typeof node.url !== 'string') return

      const { url, trailing } = trimTrailingUrlPunctuation(node.url)
      if (!trailing || !url) return

      node.url = url

      const visibleTrailing = removeTrailingText(node.children, trailing)
      if (!visibleTrailing || index === undefined || !parent?.children) return

      parent.children.splice(index + 1, 0, {
        type: 'text',
        value: visibleTrailing,
      })
    })
  }
}
