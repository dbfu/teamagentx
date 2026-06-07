/**
 * 消息提示音播放器
 * 使用 Web Audio API 生成简单的提示音，无需额外的音频文件
 */

import { useUIStore } from '@/stores/ui-store'

// AudioContext 单例
let audioContext: AudioContext | null = null

/**
 * 获取或创建 AudioContext
 */
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  }
  // 如果 context 处于 suspended 状态（通常是用户还没交互过），恢复它
  if (audioContext.state === 'suspended') {
    audioContext.resume()
  }
  return audioContext
}

/**
 * 检查提示音是否启用
 */
export function isSoundEnabled(): boolean {
  return useUIStore.getState().soundEnabled
}

/**
 * 播放消息提示音
 * 生成一个清脆的"叮-叮"双音通知效果（类似手机通知音）
 */
export function playMessageSound(): void {
  // 检查提示音是否启用
  if (!isSoundEnabled()) {
    return
  }

  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    // 第一个音：高音 "叮"
    const osc1 = ctx.createOscillator()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(1200, now) // D6

    const gain1 = ctx.createGain()
    gain1.gain.setValueAtTime(0.25, now)
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15)

    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.15)

    // 第二个音：稍低的 "叮"（延迟一点）
    const osc2 = ctx.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(900, now + 0.12) // A5

    const gain2 = ctx.createGain()
    gain2.gain.setValueAtTime(0.2, now + 0.12)
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3)

    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.12)
    osc2.stop(now + 0.3)
  } catch (e) {
    // 静默失败，不影响用户体验
    console.warn('播放提示音失败:', e)
  }
}