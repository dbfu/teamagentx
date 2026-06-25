import { useEffect, useState, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore, useThrottledStreamEvents } from '@/stores/chat-store'
import type { CharacterAnim } from './office-character'
import type { ChatRoomAgent } from '@/lib/agent-api'
import { chatRoomApi } from '@/lib/agent-api'
import type { WallItem } from './office-furniture'
import { generateRoomWalls } from './office-furniture'

type Vec3 = [number, number, number]
interface Station {
  pos: Vec3
  rot: number
}

export interface OfficeAgentDef {
  id: string
  name: string
  avatar: string
  agentLevel?: 'normal' | 'system'
  color: string
  task: string
  deskFurniture: Vec3
  desk: Station
}

/** 根据助手数量均匀分配工位 x 坐标，间距最大 3.4，总宽最大 16 */
function calcDeskXPositions(count: number): number[] {
  if (count === 0) return []
  if (count === 1) return [0]
  const step = Math.min(3.4, 16 / (count - 1))
  const span = step * (count - 1)
  return Array.from({ length: count }, (_, i) => -span / 2 + i * step)
}

// 每排最多 6 张桌子；超过则换到后面一排
const DESK_PER_ROW = 6
// 各排办公桌的 z 坐标（越往后越小）；人坐在桌子前方 z + 1.3 处
const ROW_DESK_Z = [-2.5, -5.5]

/**
 * 根据助手数量计算每个工位的 [x, z]。
 * 分多排，每排 DESK_PER_ROW 张，每排各自居中排布。
 */
function calcDeskLayout(count: number): { x: number; z: number }[] {
  const result: { x: number; z: number }[] = []
  const rows = Math.max(1, Math.ceil(count / DESK_PER_ROW))
  for (let r = 0; r < rows; r++) {
    const start = r * DESK_PER_ROW
    const rowCount = Math.min(DESK_PER_ROW, count - start)
    const xs = calcDeskXPositions(rowCount)
    // 超出预设排数时继续往后推（每排间隔 3）
    const z = ROW_DESK_Z[r] ?? ROW_DESK_Z[ROW_DESK_Z.length - 1] - 3 * (r - (ROW_DESK_Z.length - 1))
    for (let c = 0; c < rowCount; c++) {
      result.push({ x: xs[c], z })
    }
  }
  return result
}

// 根据助手 ID 生成固定的颜色（基于哈希）
function generateColorFromId(agentId: string): string {
  // 使用简单哈希函数将 ID 转换为数字
  let hash = 0
  for (let i = 0; i < agentId.length; i++) {
    hash = agentId.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash // 转换为整数
  }
  // 使用哈希值生成 HSL 颜色
  const hue = Math.abs(hash) % 360
  const saturation = 65 + (Math.abs(hash >> 8) % 25) // 65-90%
  const lightness = 45 + (Math.abs(hash >> 16) % 15) // 45-60%
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}
// ---- 正方形房间网格布局系统 ----
// 所有房间统一 8×8 正方形尺寸，按网格坐标螺旋扩展分配位置。
// 优势：布局简洁、无重叠风险、易于扩展。

export type FurnKind =
  | 'table' | 'sofa' | 'bed' | 'mat' | 'cushion'
  | 'tv' | 'console' | 'arcade' | 'dumbbell' | 'treadmill' | 'plant'
export interface FurnItem { kind: FurnKind; pos: Vec3; rotationY: number; color?: string }
export interface FloorRect { cx: number; cz: number; w: number; d: number; color: string }

interface FurnLocal { kind: FurnKind; dx: number; dz: number; rotationY?: number; color?: string }
interface SeatLocal { anim: SlottedAnim; dx: number; dz: number; rot: number }

// 正方形房间模板（统一 8×8）
interface SquareRoomTemplate {
  type: 'break' | 'gym' | 'rest' | 'entertainment'
  color: string
  size: number          // 正方形边长（统一 8）
  primaryCap: number    // 主座位数
  furn: FurnLocal[]     // 家具相对位置
  seats: SeatLocal[]    // 座位相对位置
}

const PAL = ['#6bb36b', '#5b9bd5', '#e08a5b', '#a87fce', '#c47c5a', '#7ba3c8']
const ROOM_SIZE = 8
const GAP = 2

// 入口绿植固定位置（同时用于扩展办公区地面范围，让树脚下铺房间淡色地砖，而非走廊深色）
export const ENTRANCE_TREES: [number, number, number][] = [
  [-9, 0, -7],
  [9, 0, -7],
]

// 正方形房间模板定义（适应 8×8）
const SQUARE_ROOM_TEMPLATES: SquareRoomTemplate[] = [
  // 茶水间：2圆桌 × 4椅 = 8座（保持原有座位数）
  {
    type: 'break',
    color: '#ecdcc4',
    size: 8,
    primaryCap: 8,
    furn: [
      { kind: 'table', dx: 0, dz: -1.5 },
      { kind: 'table', dx: 0, dz: 1.5 },
    ],
    seats: ([-1.5, 1.5] as number[]).flatMap((tz) => ([
      { anim: 'eating', dx: 0, dz: tz - 0.85, rot: 0 },
      { anim: 'eating', dx: 0, dz: tz + 0.85, rot: Math.PI },
      { anim: 'eating', dx: -0.85, dz: tz, rot: -Math.PI / 2 },
      { anim: 'eating', dx: 0.85, dz: tz, rot: Math.PI / 2 },
    ] as SeatLocal[])),
  },
  // 健身房：6瑜伽垫 + 器材 = 6座
  {
    type: 'gym',
    color: '#e3e8ed',
    size: 8,
    primaryCap: 6,
    furn: [
      // 6张瑜伽垫均匀分布
      ...[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((dx, i) => ({ kind: 'mat' as FurnKind, dx, dz: -1.5, color: PAL[i % PAL.length] })),
      { kind: 'dumbbell', dx: -2.8, dz: 1.5 },
      { kind: 'treadmill', dx: 1.5, dz: 1.5 },
    ],
    seats: [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((dx) => ({ anim: 'workout', dx, dz: -1.5, rot: Math.PI } as SeatLocal)),
  },
  // 休息室：沙发4座 + 床2座 = 6座
  {
    type: 'rest',
    color: '#f2e7d6',
    size: 8,
    primaryCap: 6,
    furn: [
      { kind: 'sofa', dx: 0, dz: -2, rotationY: Math.PI },  // 沙发居中
      { kind: 'bed', dx: -1.5, dz: 2, rotationY: Math.PI / 2 },  // 床1
      { kind: 'bed', dx: 1.5, dz: 2, rotationY: Math.PI / 2 },   // 床2
    ],
    seats: [
      // 沙发4座
      ...[-1.5, -0.5, 0.5, 1.5].map((d) => ({ anim: 'sitting', dx: d, dz: -1.9, rot: Math.PI } as SeatLocal)),
      // 床尾各1座（共2座）
      { anim: 'sleeping', dx: -1.5, dz: 2.8, rot: -Math.PI / 2 },
      { anim: 'sleeping', dx: 1.5, dz: 2.8, rot: -Math.PI / 2 },
    ],
  },
  // 娱乐室：电视 + 游戏机 + 街机 + 6坐垫 = 6座
  {
    type: 'entertainment',
    color: '#e7dcf1',
    size: 8,
    primaryCap: 6,
    furn: [
      { kind: 'tv', dx: 0, dz: -3 },
      { kind: 'console', dx: -2.5, dz: -2.5 },
      { kind: 'arcade', dx: 2.5, dz: -2, rotationY: -Math.PI / 2 },
      { kind: 'plant', dx: -3, dz: 1.5 },
      // 6个坐垫分两排
      ...([-2, -1, 0, 1, 2, 3] as number[]).map((dx, i) => ({ kind: 'cushion' as FurnKind, dx: dx - 0.5, dz: i < 3 ? 0 : 1.5, color: PAL[(i + 2) % PAL.length] })),
    ],
    seats: [
      // 两排座位
      ...([-2, -1, 0] as number[]).map((dx) => ({ anim: 'gaming', dx: dx - 0.5, dz: 0.1, rot: Math.PI } as SeatLocal)),
      ...([1, 2, 3] as number[]).map((dx) => ({ anim: 'gaming', dx: dx - 0.5, dz: 1.6, rot: Math.PI } as SeatLocal)),
    ],
  },
]

// 螺旋扩展优先顺序（活动房间专用，只在 Z >= 1 区域扩展）
// 工位区在 Z < 0（实际 Z = -2.5, -5.5, ...），活动房间在 Z >= 1 避免重叠
const ACTIVITY_SPIRAL_ORDER: [number, number][] = [
  [-1, 1], [1, 1],        // 左右两侧（与老板办公室同行）
  [-2, 1], [2, 1],        // 左右远端
  [-1, 2], [1, 2],        // 上方左右
  [-2, 2], [2, 2],        // 上方远端角落
  [-3, 1], [3, 1],        // 极远左右
  [0, 2],                 // 上方中央（避免 X=0 与工位区重叠）
  [-1, 3], [1, 3],        // 上方远端两侧
  [-3, 2], [3, 2],        // 极远上方
  [-2, 3], [2, 3],        // 上方极远
  [-4, 1], [4, 1],        // 更远左右
  [-4, 2], [4, 2],        // 更远上方
  [-1, 4], [1, 4],        // 再上方两侧
  [-3, 3], [3, 3],        // 中等远端
  [-5, 1], [5, 1],        // 极远左右
  [-5, 2], [5, 2],        // 极远上方
  [-2, 4], [2, 4],        // 上方更远两侧
  [-4, 3], [4, 3],        // 远端角落
  [-3, 4], [3, 4],        // 更远角落
  [-6, 1], [6, 1],        // 极远左右
  [-6, 2], [6, 2],        // 极远上方
]

// 各类活动房间的固定网格位置（避免与工位区 X=0 和 Z<0 重叠）
const ROOM_FIXED_POSITIONS: Record<string, [number, number]> = {
  break: [-1, 1],         // 茶水间：左侧
  gym: [1, 1],            // 健身房：右侧
  rest: [-2, 1],          // 休息室：左侧远端
  entertainment: [2, 1],  // 娱乐室：右侧远端
}

// 网格坐标 → 世界坐标转换
function gridToWorld(gx: number, gz: number): [number, number] {
  const step = ROOM_SIZE + GAP
  return [gx * step, gz * step]
}

// 在活动区域（Z >= 1）找到空闲位置
function findActivityGridSlot(occupied: Set<string>): [number, number] {
  // 先在预设顺序中查找（只搜索 Z >= 1）
  for (const [gx, gz] of ACTIVITY_SPIRAL_ORDER) {
    const key = `${gx},${gz}`
    if (!occupied.has(key)) {
      occupied.add(key)
      return [gx, gz]
    }
  }
  // 超出预设顺序，动态扩展（限制 Z >= 1，避免与工位区重叠）
  let ring = 3
  while (true) {
    for (let gx = -ring; gx <= ring; gx++) {
      for (let gz = 1; gz <= ring; gz++) { // 只搜索 Z >= 1
        // 只处理当前环的外边界
        if (Math.abs(gx) === ring || gz === ring) {
          const key = `${gx},${gz}`
          if (!occupied.has(key)) {
            occupied.add(key)
            return [gx, gz]
          }
        }
      }
    }
    ring++
    if (ring > 15) break // 安全边界
  }
  return [-ring, ring] // 兜底（左侧上方）
}

export interface OfficeLayout {
  pools: Record<SlottedAnim, Station[]>
  floors: FloorRect[]
  furniture: FurnItem[]
  walls: WallItem[]
  bossOffice: { cx: number; cz: number }  // 老板办公室网格位置
  mapBounds: { minX: number; maxX: number; minZ: number; maxZ: number }  // 动态地图边界
}

function buildOfficeLayout(count: number): OfficeLayout {
  const pools: Record<SlottedAnim, Station[]> = { sitting: [], sleeping: [], eating: [], workout: [], gaming: [] }
  const floors: FloorRect[] = []
  const furniture: FurnItem[] = []
  const walls: WallItem[] = []
  const occupied = new Set<string>()

  // 需要的活动座位规模（并非所有人同时休息，取人数的一部分）
  const need = Math.max(1, Math.ceil(count * 0.4))

  // 1. 老板办公室固定在网格 [0,1]
  occupied.add('0,1')
  const [bossCx, bossCz] = gridToWorld(0, 1)
  floors.push({ cx: bossCx, cz: bossCz, w: ROOM_SIZE, d: ROOM_SIZE, color: '#ebe6da' })
  // 老板办公室的墙
  walls.push(...generateRoomWalls(bossCx, bossCz, ROOM_SIZE))
  // 老板办公室家具在 office-page.tsx 中独立渲染，此处只添加地面

  // 2. 工位区固定在网格 [0,0] 附近，动态扩展（基于实际工位位置）
  occupied.add('0,0')
  const desks = calcDeskLayout(count)
  // 工位区地面只根据实际工位位置计算，不再硬编码初始范围
  let deskMinX = Infinity, deskMaxX = -Infinity, deskMinZ = Infinity, deskMaxZ = -Infinity
  for (const d of desks) {
    deskMinX = Math.min(deskMinX, d.x - 1.5)
    deskMaxX = Math.max(deskMaxX, d.x + 1.5)
    deskMinZ = Math.min(deskMinZ, d.z - 1.3)
    deskMaxZ = Math.max(deskMaxZ, d.z + 2.3)
  }
  // 如果没有工位，设置一个最小默认范围（网格 [0,0] 中心附近）
  if (deskMinX === Infinity) {
    deskMinX = -5
    deskMaxX = 5
    deskMinZ = -4
    deskMaxZ = 2
  }
  // 把入口绿植纳入办公区地面范围，使树脚下铺淡色房间地砖
  for (const [tx, , tz] of ENTRANCE_TREES) {
    deskMinX = Math.min(deskMinX, tx - 1.5)
    deskMaxX = Math.max(deskMaxX, tx + 1.5)
    deskMinZ = Math.min(deskMinZ, tz - 1.5)
    deskMaxZ = Math.max(deskMaxZ, tz + 1.5)
  }
  const deskCx = (deskMinX + deskMaxX) / 2
  const deskCz = (deskMinZ + deskMaxZ) / 2
  const deskW = deskMaxX - deskMinX
  const deskD = deskMaxZ - deskMinZ
  floors.push({ cx: deskCx, cz: deskCz, w: deskW, d: deskD, color: '#edeff3' })
  // 工位区暂不加墙（开放式办公区）

  // 3. 计算各类活动房间需要的份数（统一 primaryCap=6，茶水间保持8）
  const roomCounts: Record<string, number> = {
    break: Math.max(1, Math.ceil(need / 8)),       // 茶水间8座
    gym: Math.max(1, Math.ceil(need / 6)),         // 健身房6座
    rest: Math.max(1, Math.ceil(need / 6)),        // 休息室6座
    entertainment: Math.max(1, Math.ceil(need / 6)), // 娱乐室6座
  }

  // 4. 分配活动房间位置（只在 Z >= 1 区域，避免与工位区 Z < 0 重叠）
  for (const tpl of SQUARE_ROOM_TEMPLATES) {
    const copies = roomCounts[tpl.type] ?? 1
    for (let c = 0; c < copies; c++) {
      // 第一份使用固定位置，后续副本在活动区域螺旋扩展
      let gx: number, gz: number
      if (c === 0 && ROOM_FIXED_POSITIONS[tpl.type]) {
        const fixed = ROOM_FIXED_POSITIONS[tpl.type]
        const key = `${fixed[0]},${fixed[1]}`
        if (!occupied.has(key)) {
          occupied.add(key)
          gx = fixed[0]
          gz = fixed[1]
        } else {
          // 固定位置被占用，使用活动区域扩展
          [gx, gz] = findActivityGridSlot(occupied)
        }
      } else {
        [gx, gz] = findActivityGridSlot(occupied)
      }
      const [cx, cz] = gridToWorld(gx, gz)
      floors.push({ cx, cz, w: ROOM_SIZE, d: ROOM_SIZE, color: tpl.color })
      // 添加房间的墙
      walls.push(...generateRoomWalls(cx, cz, ROOM_SIZE))
      // 添加家具
      for (const f of tpl.furn) {
        furniture.push({ kind: f.kind, pos: [cx + f.dx, 0, cz + f.dz], rotationY: f.rotationY ?? 0, color: f.color })
      }
      // 添加座位
      for (const s of tpl.seats) {
        pools[s.anim].push({ pos: [cx + s.dx, 0, cz + s.dz], rot: s.rot })
      }
    }
  }

  // 动态计算地图边界：覆盖所有地面 + 边距
  let minX = -15, maxX = 15, minZ = -10, maxZ = 15
  for (const f of floors) {
    minX = Math.min(minX, f.cx - f.w / 2)
    maxX = Math.max(maxX, f.cx + f.w / 2)
    minZ = Math.min(minZ, f.cz - f.d / 2)
    maxZ = Math.max(maxZ, f.cz + f.d / 2)
  }
  // 添加边距，让老板能在房间边缘自由移动
  const margin = 4
  const mapBounds = { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin }

  return { pools, floors, furniture, walls, bossOffice: { cx: bossCx, cz: bossCz }, mapBounds }
}

// 将群聊助手映射到办公室助手定义
function mapChatRoomAgentsToOffice(chatRoomAgents: ChatRoomAgent[], t: ReturnType<typeof useTranslation>['t']): OfficeAgentDef[] {
  const filtered = chatRoomAgents.filter(cra => cra.agent)
  const layout = calcDeskLayout(filtered.length)
  return filtered.map((cra, i) => {
    const agent = cra.agent!
    // 根据助手 ID 生成固定的颜色，下次进来还是这个颜色
    const color = generateColorFromId(agent.id)
    const avatar = agent.avatar || agent.name.charAt(0).toUpperCase()
    const { x, z } = layout[i]
    return {
      id: agent.id,
      name: agent.name,
      avatar,
      agentLevel: agent.agentLevel,
      color,
      task: `@${agent.name} ${t('office.status.idleWaiting')}`,
      deskFurniture: [x, 0, z] as Vec3,
      desk: { pos: [x, 0, z + 1.3] as Vec3, rot: Math.PI },
    }
  })
}

// 根据助手状态和事件流判断动画状态（仅处理执行中的状态）
function getSocketAnim(
  agentId: string,
  agentStatuses: Map<string, string>,
  streamEvents: Map<string, any[]>,
): CharacterAnim | 'idle' {
  const status = agentStatuses.get(agentId)
  // 空闲状态返回 idle
  if (status === 'idle' || !status) return 'idle'
  // 执行中或忙碌状态，根据事件流判断具体动画
  if (status === 'executing' || status === 'busy') {
    let latestEvents: any[] = []
    for (const [key, events] of streamEvents) {
      if (key.includes(agentId)) latestEvents = events
    }
    const hasToolCall = latestEvents.some(e => e.type === 'tool_call')
    const hasThinking = latestEvents.some(e => e.type === 'thinking')
    const hasOutput = latestEvents.some(e => e.type === 'output')
    if (hasToolCall) return 'typing'
    if (hasThinking) return 'thinking'
    if (hasOutput) return 'talking'
    // 没有事件流时默认返回 typing（表示正在工作中）
    return 'typing'
  }
  // 其他状态默认返回 idle
  return 'idle'
}

// 需要抢占式调度的动画状态
type SlottedAnim = 'sitting' | 'sleeping' | 'eating' | 'workout' | 'gaming'
function isSlotted(anim: string): anim is SlottedAnim {
  return anim === 'sitting' || anim === 'sleeping' || anim === 'eating' || anim === 'workout' || anim === 'gaming'
}

// 空闲时自主活动池（全部去休息区，不在工位上）
// 移除 walking，避免在工位区域走动
const IDLE_POOL: CharacterAnim[] = [
  'sitting', 'sitting', 'sitting',
  'eating', 'eating',
  'workout', 'workout',
  'gaming', 'gaming', 'gaming',
  'sleeping', 'sleeping',
]

// 各活动持续时长范围（毫秒）
const ACTIVITY_DURATION: Record<string, [number, number]> = {
  idle:    [8000,  20000],
  walking: [4000,  10000],
  sitting: [12000, 30000],
  eating:  [15000, 35000],
  workout: [12000, 25000],
  gaming:  [15000, 35000],
  sleeping:[20000, 45000],
}

/**
 * 对接真实助手状态的 hook：
 * - 执行任务时由 socket 事件驱动动画（在工位上）
 * - 空闲时去休息区活动（沙发、茶水间、健身房、休息区床）
 */
export function useOfficeRealAgents(chatRoomId: string) {
  const { t } = useTranslation()
  const agentStatuses = useChatStore((state) => state.agentStatuses)
  // 节流读取，避免流式每 token 驱动 3D 助手动画/气泡重算
  const streamEvents = useThrottledStreamEvents()

  const [chatRoomAgents, setChatRoomAgents] = useState<ChatRoomAgent[]>([])
  const [chatRoomName, setChatRoomName] = useState<string>('')
  const [autoStates, setAutoStates] = useState<Record<string, CharacterAnim>>({})
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // 保存已完成的输出内容（任务完成后 streamEvents 会被清空，这里保留最后输出）
  const completedOutputsRef = useRef<Record<string, string>>({})

  // 位置调度状态：记录哪个 agent 占用了哪个坑位
  const slotState = useRef<{
    slots: Record<string, { anim: SlottedAnim; idx: number }>
    occupied: Record<SlottedAnim, Set<number>>
  }>({
    slots: {},
    occupied: { sitting: new Set(), sleeping: new Set(), eating: new Set(), workout: new Set(), gaming: new Set() },
  })

  // 用 ref 存调度函数，避免 useEffect 依赖链循环
  const scheduleNextRef = useRef<(agentId: string) => void>(() => {})
  scheduleNextRef.current = (agentId: string) => {
    const activity = IDLE_POOL[Math.floor(Math.random() * IDLE_POOL.length)]
    setAutoStates(prev => ({ ...prev, [agentId]: activity }))
    const [min, max] = ACTIVITY_DURATION[activity] ?? [8000, 20000]
    const delay = min + Math.random() * (max - min)
    const timer = setTimeout(() => scheduleNextRef.current(agentId), delay)
    timers.current.set(agentId, timer)
  }

  // 获取群聊助手列表
  useEffect(() => {
    if (!chatRoomId) return
    chatRoomApi.getById(chatRoomId)
      .then(res => {
        if (res.data?.chatRoomAgents) setChatRoomAgents(res.data.chatRoomAgents)
        if (res.data?.name) setChatRoomName(res.data.name)
      })
      .catch(err => console.error('Failed to fetch chat room agents:', err))
  }, [chatRoomId])

  const agents = useMemo(() => mapChatRoomAgentsToOffice(chatRoomAgents, t), [chatRoomAgents, t])

  // 按助手数量动态生成各活动区坑位与家具布局
  const layout = useMemo(() => buildOfficeLayout(agents.length), [agents.length])

  // 空闲时启动自主活动，有任务时立即暂停
  useEffect(() => {
    const activeIds = new Set(agents.map(a => a.id))

    for (const agent of agents) {
      const status = agentStatuses.get(agent.id)
      const isIdle = !status || status === 'idle'

      if (isIdle) {
        // 尚未有定时器时才开始（避免重复启动）
        if (!timers.current.has(agent.id)) {
          scheduleNextRef.current(agent.id)
        }
      } else {
        // 有任务：停止自主行为
        const timer = timers.current.get(agent.id)
        if (timer) {
          clearTimeout(timer)
          timers.current.delete(agent.id)
        }
        setAutoStates(prev => {
          if (!(agent.id in prev)) return prev
          const next = { ...prev }
          delete next[agent.id]
          return next
        })
      }
    }

    // 清理已从群聊移除的助手定时器
    for (const [id, timer] of timers.current.entries()) {
      if (!activeIds.has(id)) {
        clearTimeout(timer)
        timers.current.delete(id)
      }
    }
  }, [agents, agentStatuses])

  // 组件卸载时清理所有定时器
  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) clearTimeout(timer)
      timers.current.clear()
    }
  }, [])

  // 合并 socket 状态与自主状态：执行任务优先，空闲时用自主状态
  const states = useMemo(() => {
    const result: Record<string, CharacterAnim> = {}
    for (const agent of agents) {
      const socketAnim = getSocketAnim(agent.id, agentStatuses, streamEvents)
      result[agent.id] = socketAnim === 'idle'
        ? (autoStates[agent.id] ?? 'idle')
        : socketAnim
    }
    return result
  }, [agents, agentStatuses, streamEvents, autoStates])

  // 提取流式输出内容，保存已完成的输出
  const outputs = useMemo(() => {
    const result: Record<string, string> = {}
    for (const agent of agents) {
      // 从 streamEvents 获取当前输出
      let currentOutput = ''
      for (const [key, events] of streamEvents) {
        if (key.includes(agent.id)) {
          const content = events
            .filter(e => e.type === 'output')
            .map(e => e.content || '')
            .join('')
          if (content) currentOutput = content.slice(-2000)
        }
      }
      // 有当前输出时保存到 ref，没有时从 ref 获取已完成的输出
      if (currentOutput) {
        completedOutputsRef.current[agent.id] = currentOutput
        result[agent.id] = currentOutput
      } else if (completedOutputsRef.current[agent.id]) {
        result[agent.id] = completedOutputsRef.current[agent.id]
      }
    }
    return result
  }, [agents, streamEvents])

  // 动态位置调度：同一坑位同一时刻只允许一个 agent 占用
  const stations = useMemo(() => {
    const ss = slotState.current
    const pools = layout.pools
    const agentSet = new Set(agents.map(a => a.id))

    // 坑位池可能因人数变化而缩小，释放越界的占用
    for (const id of Object.keys(ss.slots)) {
      const cur = ss.slots[id]
      if (cur.idx >= pools[cur.anim].length) {
        ss.occupied[cur.anim].delete(cur.idx)
        delete ss.slots[id]
      }
    }

    // 清理已离开群聊的 agent 占用的坑位
    for (const id of Object.keys(ss.slots)) {
      if (!agentSet.has(id)) {
        ss.occupied[ss.slots[id].anim].delete(ss.slots[id].idx)
        delete ss.slots[id]
      }
    }

    // 释放状态已变更的 agent 的坑位
    for (const agent of agents) {
      const anim = states[agent.id] ?? 'idle'
      const cur = ss.slots[agent.id]
      if (cur && (cur.anim !== anim || !isSlotted(anim))) {
        ss.occupied[cur.anim].delete(cur.idx)
        delete ss.slots[agent.id]
      }
    }

    // 为新进入坑位状态的 agent 分配最小空闲坑位
    for (const agent of agents) {
      const anim = states[agent.id] ?? 'idle'
      if (isSlotted(anim) && !ss.slots[agent.id]) {
        const pool = pools[anim]
        for (let i = 0; i < pool.length; i++) {
          if (!ss.occupied[anim].has(i)) {
            ss.slots[agent.id] = { anim, idx: i }
            ss.occupied[anim].add(i)
            break
          }
        }
      }
    }

    // 构建站位表，坑位满时降级为工位 + idle
    const stationMap: Record<string, Station> = {}
    const effectiveStates: Record<string, CharacterAnim> = {}
    for (const agent of agents) {
      const anim = states[agent.id] ?? 'idle'
      const slot = ss.slots[agent.id]
      if (slot) {
        stationMap[agent.id] = pools[slot.anim][slot.idx]
        effectiveStates[agent.id] = anim
      } else if (isSlotted(anim)) {
        // 没有空位，原地 idle
        stationMap[agent.id] = agent.desk
        effectiveStates[agent.id] = 'idle'
      } else {
        // 非坑位状态（idle/工作中）统一回到工位
        stationMap[agent.id] = agent.desk
        effectiveStates[agent.id] = anim
      }
    }
    return { stationMap, effectiveStates }
  }, [agents, states, layout])

  return {
    agents,
    states: stations.effectiveStates,
    outputs,
    stations: stations.stationMap,
    chatRoomName,
    furniture: layout.furniture,
    floors: layout.floors,
    walls: layout.walls,
    bossOffice: layout.bossOffice,
    mapBounds: layout.mapBounds,
  }
}
