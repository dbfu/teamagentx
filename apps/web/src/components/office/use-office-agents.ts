import { useEffect, useMemo, useRef, useState } from 'react'
import type { CharacterAnim } from './office-character'

type Vec3 = [number, number, number]
interface Station {
  pos: Vec3
  rot: number
}

export interface OfficeAgentDef {
  id: string
  name: string
  avatar: string
  color: string
  task: string
  deskFurniture: Vec3
  desk: Station
  sofaSeat: Station
  bedSpot: Station
  tableChair: Station
  gymSpot: Station
}

// 工位横向排布（放大后间距更宽）
const DESK_X = [-5, -1.7, 1.7, 5]
// 沙发座位：休息区沙发位置 [13, 0, 3.5]，宽度4
const SOFA_SEATS: Station[] = [
  { pos: [11.5, 0, 2.5], rot: Math.PI },
  { pos: [12.5, 0, 2.5], rot: Math.PI },
  { pos: [13.5, 0, 2.5], rot: Math.PI },
  { pos: [14.5, 0, 2.5], rot: Math.PI },
]
// 床位：三张床并排放 z=7，x=11/13/15
const BED_SPOTS: Station[] = [
  { pos: [11, 0, 7], rot: -Math.PI / 2 },
  { pos: [13, 0, 7], rot: -Math.PI / 2 },
  { pos: [15, 0, 7], rot: -Math.PI / 2 },
]
// 餐桌椅子：茶水间左移至 x=-7
const TABLE_CHAIRS: Station[] = [
  { pos: [-7, 0, 2.7], rot: 0 },
  { pos: [-7, 0, 4.3], rot: Math.PI },
  { pos: [-7.9, 0, 3.5], rot: Math.PI / 2 },
  { pos: [-6.1, 0, 3.5], rot: -Math.PI / 2 },
  { pos: [-7, 0, 5.7], rot: 0 },
  { pos: [-7, 0, 7.3], rot: Math.PI },
  { pos: [-7.9, 0, 6.5], rot: Math.PI / 2 },
  { pos: [-6.1, 0, 6.5], rot: -Math.PI / 2 },
]
// 健身区站位（在健身室范围内 x=3.25~10，器材在后 z=6）
export const GYM_SPOTS: Station[] = [
  { pos: [4.2, 0, 3.5], rot: Math.PI },
  { pos: [5.6, 0, 3.5], rot: Math.PI },
  { pos: [7.0, 0, 3.5], rot: Math.PI },
  { pos: [8.4, 0, 3.5], rot: Math.PI },
]

const RAW: Omit<OfficeAgentDef, 'deskFurniture' | 'desk' | 'sofaSeat' | 'bedSpot' | 'tableChair' | 'gymSpot'>[] = [
  { id: 'a1', name: 'Claude', avatar: 'C', color: '#4f7cff', task: '@Claude 帮我把数据库迁移一下，加个 Office 表' },
  { id: 'a2', name: 'Codex', avatar: 'X', color: '#10b981', task: '@Codex 给登录接口补一组单元测试' },
  { id: 'a3', name: 'Gemini', avatar: 'G', color: '#f59e0b', task: '@Gemini 调研一下 3D 渲染库的选型' },
  { id: 'a4', name: 'Qwen', avatar: 'Q', color: '#a855f7', task: '@Qwen 把首页文案翻译成英文' },
]

export const AGENTS: OfficeAgentDef[] = RAW.map((a, i) => ({
  ...a,
  deskFurniture: [DESK_X[i], 0, -2.5],
  desk: { pos: [DESK_X[i], 0, -1.2], rot: Math.PI },
  sofaSeat: SOFA_SEATS[i],
  bedSpot: BED_SPOTS[i % 3], // 3张床，轮流分配
  tableChair: TABLE_CHAIRS[i],
  gymSpot: GYM_SPOTS[i],
}))

export function stationFor(agent: OfficeAgentDef, anim: CharacterAnim): Station {
  if (anim === 'sitting') return agent.sofaSeat
  if (anim === 'sleeping') return agent.bedSpot
  if (anim === 'eating') return agent.tableChair
  if (anim === 'workout') return agent.gymSpot
  return agent.desk
}

type SlottedAnim = 'sitting' | 'sleeping' | 'eating' | 'workout'
const SLOT_POOLS: Record<SlottedAnim, Station[]> = {
  sitting: SOFA_SEATS,
  sleeping: BED_SPOTS,
  eating: TABLE_CHAIRS,
  workout: GYM_SPOTS,
}
function isSlotted(anim: string): anim is SlottedAnim {
  return anim === 'sitting' || anim === 'sleeping' || anim === 'eating' || anim === 'workout'
}

// 不同状态下显示器/面板里的产出文本
export const STATE_OUTPUT: Partial<Record<CharacterAnim, string>> = {
  thinking: '🤔 正在分析需求，拆解步骤、确认改动范围…',
  typing: '$ pnpm build\n> tsc -b && vite build\n✔ built in 3.2s\n$ pnpm test\n✔ 24 passed',
  talking: '已经按要求完成，主要改了 3 个文件。\n要我继续下一步吗？',
}

// 自主行为池（工作状态权重更高，偶尔去休息/干饭/走动/睡觉）
const POOL: CharacterAnim[] = [
  'typing', 'typing', 'thinking', 'thinking', 'talking',
  'idle', 'walking', 'sitting', 'eating', 'workout', 'sleeping',
]

function randomAnim() {
  return POOL[Math.floor(Math.random() * POOL.length)]
}

/**
 * 管理多个助手的自主状态：每个助手独立地、错峰地切换动作，
 * 让办公室看起来是"活的"。后续可替换为真实 socket 事件驱动。
 */
export function useOfficeAgents() {
  const [states, setStates] = useState<Record<string, CharacterAnim>>(() =>
    Object.fromEntries(AGENTS.map((a, i) => [a.id, (['typing', 'thinking', 'talking', 'idle'] as CharacterAnim[])[i % 4]])),
  )

  useEffect(() => {
    const timers = AGENTS.map((a) => {
      const tick = () => setStates((s) => ({ ...s, [a.id]: randomAnim() }))
      return setInterval(tick, 3500 + Math.random() * 4500)
    })
    return () => timers.forEach(clearInterval)
  }, [])

  // 一键：全员开工 / 全员午休
  const setAllBusy = () =>
    setStates(Object.fromEntries(AGENTS.map((a, i) => [a.id, (['typing', 'thinking', 'talking'] as CharacterAnim[])[i % 3]])))
  const setAllBreak = () =>
    setStates(Object.fromEntries(AGENTS.map((a, i) => [a.id, (['sitting', 'eating', 'sitting', 'eating'] as CharacterAnim[])[i % 4]])))
  const setAllWorkout = () => setStates(Object.fromEntries(AGENTS.map((a) => [a.id, 'workout' as CharacterAnim])))

  const outputs: Record<string, string> = Object.fromEntries(
    AGENTS.map((a) => [a.id, STATE_OUTPUT[states[a.id]] ?? '']),
  )

  const slotState = useRef<{
    slots: Record<string, { anim: SlottedAnim; idx: number }>
    occupied: Record<SlottedAnim, Set<number>>
  }>({
    slots: {},
    occupied: { sitting: new Set(), sleeping: new Set(), eating: new Set(), workout: new Set() },
  })

  const stations = useMemo(() => {
    const ss = slotState.current

    for (const agent of AGENTS) {
      const anim = states[agent.id] ?? 'idle'
      const cur = ss.slots[agent.id]
      if (cur && (cur.anim !== anim || !isSlotted(anim))) {
        ss.occupied[cur.anim].delete(cur.idx)
        delete ss.slots[agent.id]
      }
    }

    for (const agent of AGENTS) {
      const anim = states[agent.id] ?? 'idle'
      if (isSlotted(anim) && !ss.slots[agent.id]) {
        const pool = SLOT_POOLS[anim]
        for (let i = 0; i < pool.length; i++) {
          if (!ss.occupied[anim].has(i)) {
            ss.slots[agent.id] = { anim, idx: i }
            ss.occupied[anim].add(i)
            break
          }
        }
      }
    }

    const stationMap: Record<string, Station> = {}
    const effectiveStates: Record<string, CharacterAnim> = {}
    for (const agent of AGENTS) {
      const anim = states[agent.id] ?? 'idle'
      const slot = ss.slots[agent.id]
      if (slot) {
        stationMap[agent.id] = SLOT_POOLS[slot.anim][slot.idx]
        effectiveStates[agent.id] = anim
      } else if (isSlotted(anim)) {
        stationMap[agent.id] = agent.desk
        effectiveStates[agent.id] = 'idle'
      } else {
        stationMap[agent.id] = stationFor(agent, anim)
        effectiveStates[agent.id] = anim
      }
    }
    return { stationMap, effectiveStates }
  }, [states])

  return {
    states: stations.effectiveStates,
    outputs,
    stations: stations.stationMap,
    setAllBusy,
    setAllBreak,
    setAllWorkout,
  }
}
