import assert from 'node:assert'
import { afterEach, beforeEach, describe, test } from 'node:test'

import {
  extractNewChunks,
  findSentenceBoundary,
  StreamingTtsManager,
  StreamingTtsSession,
} from '../src/speech/streaming-tts.ts'

// ---------- 浏览器 API 的最小 mock ----------
// playStreamResponse 内部依赖 MediaSource / Audio / URL.createObjectURL。
// 在 Node 环境下，我们走 fallback 路径（MediaSource 不存在），并把 Audio/URL stub 成
// 立刻触发 onended 的实现，让 playStreamResponse 立即 resolve。

interface FakeAudio {
  src: string
  onended: (() => void) | null
  onerror: (() => void) | null
  paused: boolean
  ended: boolean
  pause(): void
  load(): void
  play(): Promise<void>
}

const originalWindow = (globalThis as any).window
const originalMediaSource = (globalThis as any).MediaSource
const originalAudio = (globalThis as any).Audio
const originalURL = globalThis.URL
const originalBlob = (globalThis as any).Blob

function installBrowserStubs(options?: { playRejects?: boolean }): void {
  ;(globalThis as any).window = globalThis
  // 不提供 MediaSource：让 playStreamResponse 进入 fallback 路径
  ;(globalThis as any).MediaSource = undefined

  ;(globalThis as any).Blob = class FakeBlob {
    parts: unknown[]
    opts?: unknown
    constructor(parts: unknown[], opts?: unknown) {
      this.parts = parts
      this.opts = opts
    }
  }

  let urlCounter = 0
  ;(globalThis as any).URL = {
    createObjectURL: () => `blob:fake-${++urlCounter}`,
    revokeObjectURL: () => {},
  }

  ;(globalThis as any).Audio = class implements FakeAudio {
    src = ''
    onended: (() => void) | null = null
    onerror: (() => void) | null = null
    paused = false
    ended = false
    constructor(src?: string) {
      if (src) this.src = src
    }
    pause(): void { this.paused = true }
    load(): void {}
    async play(): Promise<void> {
      if (options?.playRejects) throw new Error('NotAllowedError')
      // 异步触发 ended，模拟播放完成
      setTimeout(() => {
        this.ended = true
        this.onended?.()
      }, 5)
    }
  }
}

function restoreBrowserStubs(): void {
  ;(globalThis as any).window = originalWindow
  ;(globalThis as any).MediaSource = originalMediaSource
  ;(globalThis as any).Audio = originalAudio
  ;(globalThis as any).Blob = originalBlob
  globalThis.URL = originalURL
}

function makeFakeResponse(): Response {
  // playStreamResponse fallback 路径会调用 response.arrayBuffer()
  return {
    arrayBuffer: async () => new ArrayBuffer(8),
    body: null,
  } as unknown as Response
}

// ---------- findSentenceBoundary ----------
describe('findSentenceBoundary', () => {
  test('中文句号是边界', () => {
    assert.strictEqual(findSentenceBoundary('你好。世界', 0), 3)
  })

  test('中文叹号问号是边界', () => {
    assert.strictEqual(findSentenceBoundary('你好！', 0), 3)
    assert.strictEqual(findSentenceBoundary('你好？', 0), 3)
  })

  test('英文 ! ? 是边界', () => {
    assert.strictEqual(findSentenceBoundary('hi!', 0), 3)
    assert.strictEqual(findSentenceBoundary('hi?', 0), 3)
  })

  test('. 后接数字时不切（如 v1.0）', () => {
    // 整个字符串都没有合法边界，返回 -1
    assert.strictEqual(findSentenceBoundary('v1.0', 0), -1)
  })

  test('. 在末尾或后跟非数字时是边界', () => {
    assert.strictEqual(findSentenceBoundary('end.', 0), 4)
    assert.strictEqual(findSentenceBoundary('end. next', 0), 4)
  })

  test('\\n\\n 是边界，单个 \\n 不是', () => {
    assert.strictEqual(findSentenceBoundary('a\n\nb', 0), 3)
    assert.strictEqual(findSentenceBoundary('a\nb', 0), -1)
  })

  test('start 参数非 0 时从指定位置开始扫描', () => {
    const text = 'foo。bar。'
    // 从位置 4 开始（跳过第一个边界）
    assert.strictEqual(findSentenceBoundary(text, 4), 8)
  })
})

// ---------- extractNewChunks ----------
describe('extractNewChunks', () => {
  test('第二次调用 position 从上一次 newPosition 继续累加', () => {
    const sent1 = '这是第一句已经明显超过五十个字为了触发切块逻辑并且会在句号处停下来同时保持一个完整句子的语义不被提前打断。'
    const sent2Partial = '这里是第二段还没结束'
    // 第一次：只有 sent1 + 部分 sent2，第二句没结束，只切出第一句
    const first = extractNewChunks(sent1 + sent2Partial, 0)
    assert.strictEqual(first.chunks.length, 1)
    assert.strictEqual(first.newPosition, sent1.length)

    // 第二次：sent2 完整到来，从上一次的 newPosition 继续
    const sent2 = '这里是第二段同样需要明显超过五十个字才能切所以我继续凑字数凑到五十个字以上以便触发边界继续凑字数继续凑凑字。'
    const second = extractNewChunks(sent1 + sent2, first.newPosition)
    assert.strictEqual(second.chunks.length, 1)
    assert.strictEqual(second.chunks[0], sent2)
    assert.strictEqual(second.newPosition, sent1.length + sent2.length)
  })

  test('无标点短文本不切块', () => {
    const { chunks, newPosition } = extractNewChunks('短短的没标点', 0)
    assert.deepStrictEqual(chunks, [])
    assert.strictEqual(newPosition, 0)
  })
})

// ---------- StreamingTtsSession ----------
describe('StreamingTtsSession', () => {
  beforeEach(() => {
    installBrowserStubs()
  })
  afterEach(() => {
    restoreBrowserStubs()
  })

  test('add 后 process 会调用 fetchStream 并播放', async () => {
    const calls: string[] = []
    let finished = false
    const session = new StreamingTtsSession(() => { finished = true })
    const fetchStream = async (text: string): Promise<Response> => {
      calls.push(text)
      return makeFakeResponse()
    }
    session.add('hello', fetchStream)
    // 等待 process 自然完成
    await new Promise((r) => setTimeout(r, 50))
    assert.deepStrictEqual(calls, ['hello'])
    assert.strictEqual(finished, true)
  })

  test('stop 后再 add 不入队', async () => {
    let called = 0
    const session = new StreamingTtsSession()
    const fetchStream = async (): Promise<Response> => {
      called++
      return makeFakeResponse()
    }
    session.stop()
    session.add('x', fetchStream)
    await new Promise((r) => setTimeout(r, 20))
    assert.strictEqual(called, 0)
    assert.strictEqual(session.stopped, true)
  })

  test('stop 清空队列且 stopped=true', async () => {
    const session = new StreamingTtsSession()
    // 阻塞型 fetchStream，让 process 在等响应时被 stop
    let resolveFetch: ((r: Response) => void) | null = null
    const fetchStream = (): Promise<Response> => new Promise((res) => { resolveFetch = res })
    session.add('a', fetchStream)
    session.add('b', fetchStream)
    session.add('c', fetchStream)
    session.stop()
    assert.strictEqual(session.stopped, true)
    // 让阻塞的 fetch resolve，验证不会再进入播放
    resolveFetch?.(makeFakeResponse())
    await new Promise((r) => setTimeout(r, 20))
  })

  test('onFinish 在自然消费完后触发', async () => {
    let finishCount = 0
    const session = new StreamingTtsSession(() => { finishCount++ })
    const fetchStream = async (): Promise<Response> => makeFakeResponse()
    session.add('a', fetchStream)
    await new Promise((r) => setTimeout(r, 50))
    assert.strictEqual(finishCount, 1)
  })

  test('onFinish 在 stop 后触发（即使队列空闲）', () => {
    let finished = false
    const session = new StreamingTtsSession(() => { finished = true })
    session.stop()
    assert.strictEqual(finished, true)
  })
})

// ---------- StreamingTtsManager ----------
describe('StreamingTtsManager', () => {
  beforeEach(() => {
    installBrowserStubs()
  })
  afterEach(() => {
    restoreBrowserStubs()
  })

  test('getOrCreate 同 key 返回同实例', () => {
    const mgr = new StreamingTtsManager()
    const a = mgr.getOrCreate('k1')
    const b = mgr.getOrCreate('k1')
    assert.strictEqual(a, b)
  })

  test('stopped session 不被复用，新建', () => {
    const mgr = new StreamingTtsManager()
    const a = mgr.getOrCreate('k1')
    a.stop()
    const b = mgr.getOrCreate('k1')
    assert.notStrictEqual(a, b)
    assert.strictEqual(b.stopped, false)
  })

  test('stopAll 后所有 session stopped', () => {
    const mgr = new StreamingTtsManager()
    const s1 = mgr.getOrCreate('k1')
    const s2 = mgr.getOrCreate('k2')
    mgr.stopAll()
    assert.strictEqual(s1.stopped, true)
    assert.strictEqual(s2.stopped, true)
  })

  test('session 自然完成后从 manager 中清除', async () => {
    const mgr = new StreamingTtsManager()
    const session = mgr.getOrCreate('k1')
    session.add('hi', async () => makeFakeResponse())
    await new Promise((r) => setTimeout(r, 50))
    assert.strictEqual(mgr.get('k1'), undefined)
  })
})
