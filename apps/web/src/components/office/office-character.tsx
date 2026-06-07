import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group, Mesh } from 'three'
import { useTranslation } from 'react-i18next'
import { type WalkGrid, findPath } from './office-pathfinding'

/**
 * 办公室小人的动画状态。
 * 这些状态后续会由 socket 事件映射而来：
 *  - idle      ← agent:done / agent:status(空闲)
 *  - typing    ← agent:typing / tool_call(Bash/Edit)
 *  - thinking  ← agent:thinking
 *  - talking   ← agent:stream
 *  - walking   ← 协作/交接时的移动（Phase 2+）
 */
export type CharacterAnim =
  | 'idle'
  | 'typing'
  | 'thinking'
  | 'talking'
  | 'walking'
  | 'sitting'
  | 'eating'
  | 'workout'
  | 'sleeping'
  | 'gaming'

interface OfficeCharacterProps {
  /** 工位站位（不走动时回到这里） */
  position?: [number, number, number]
  /** 工位朝向（弧度） */
  rotationY?: number
  /** 当前动画状态 */
  anim: CharacterAnim
  /** 衣服主色，用于区分不同助手 */
  color?: string
  /** 头顶名字 */
  name?: string
  /** 头顶气泡文本（在干什么） */
  bubble?: string
  /** 点击小人 */
  onClick?: () => void
  /** 是否被选中（高亮脚下光圈） */
  selected?: boolean
  /** 走动范围 [minX, maxX, minZ, maxZ] */
  wanderBounds?: [number, number, number, number]
  /** 预构建的可行走网格，用于 A* 寻路 */
  walkGrid?: WalkGrid
  /** 老板位置 ref（用于检测距离打招呼） */
  bossPositionRef?: React.MutableRefObject<{ x: number; z: number }>
  /** 打招呼状态变化回调 */
  onGreetChange?: (isGreeting: boolean) => void
  /** 强制关闭打招呼状态（发送任务后使用） */
  forceStopGreet?: boolean
  /** 老板第一人称视角（镜头贴近时缩小头顶文字） */
  firstPerson?: boolean
  /** 助手 id，用于上报实时位置 */
  agentId?: string
  /** 共享实时位置 ref（按助手 id 写入），供相机聚焦跟随移动中的助手 */
  agentPositionsRef?: React.MutableRefObject<Record<string, { x: number; z: number }>>
  /** 原地钉住：被其他助手串门时，留在当前位置不动（不寻路、不回工位），交谈结束后再恢复 */
  freezeInPlace?: boolean
  /** 钉住时转头看向的世界坐标（一般是来访者位置） */
  lookAt?: [number, number, number]
}

// 朝目标值平滑过渡，避免姿势瞬切
function damp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

const BUBBLE_EMOJI: Record<CharacterAnim, string> = {
  idle: '',
  typing: '⌨️',
  thinking: '💭',
  talking: '💬',
  walking: '🚶',
  sitting: '😌',
  eating: '🍔',
  workout: '💪',
  sleeping: '😴',
  gaming: '🎮',
}

export function OfficeCharacter({
  position = [0, 0, 0],
  rotationY = 0,
  anim,
  color = '#4f7cff',
  name,
  bubble,
  onClick,
  selected = false,
  wanderBounds = [-9, 9, -7, 0.5],
  walkGrid,
  bossPositionRef,
  onGreetChange,
  forceStopGreet,
  firstPerson = false,
  agentId,
  agentPositionsRef,
  freezeInPlace = false,
  lookAt,
}: OfficeCharacterProps) {
  const { t } = useTranslation()
  // 确保 color 总是有效值
  const effectiveColor = color && color.trim() ? color : '#4f7cff'
  const root = useRef<Group>(null)
  const body = useRef<Mesh>(null)
  const head = useRef<Group>(null)
  const armL = useRef<Group>(null)
  const armR = useRef<Group>(null)
  const legL = useRef<Group>(null)
  const legR = useRef<Group>(null)

  // 当前位置、朝向、漫步目标
  const pos = useRef({ x: position[0], z: position[2], rotY: rotationY })
  const target = useRef<{ x: number; z: number } | null>(null)
  // 寻路路径与路点索引
  const pathRef = useRef<[number, number][]>([])
  const pathIdxRef = useRef(0)
  // 上一次已知目标（用于检测目标变化并重新寻路）
  const lastDestRef = useRef<{ x: number; z: number } | null>(null)
  // 打招呼状态：距离老板足够近时显示（用 useState 触发重新渲染）
  const [showGreet, setShowGreet] = useState(false)
  const lastGreetDist = useRef(Infinity)
  // 打招呼时的朝向（面向老板）
  const greetRotY = useRef(0)
  // 上一次打招呼状态（用于检测变化并触发回调）
  const lastShowGreet = useRef(false)

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const dt = Math.min(delta, 0.05)
    if (!root.current || !body.current || !head.current || !armL.current || !armR.current || !legL.current || !legR.current) return

    // 检测与老板距离，触发打招呼（优先检测）
    // 直接读取 ref.current 获取实时位置
    const bossPosition = bossPositionRef?.current

    // 执行任务（含赶往工位走路）时视为忙碌，不打招呼
    const isBusy = anim === 'typing' || anim === 'thinking' || anim === 'talking'

    // 强制关闭打招呼状态（发送任务后，或正在忙碌时）
    if ((forceStopGreet || isBusy) && showGreet) {
      setShowGreet(false)
      lastShowGreet.current = false
      onGreetChange?.(false)
    } else if (bossPosition && !forceStopGreet && !isBusy) {
      const dist = Math.hypot(bossPosition.x - pos.current.x, bossPosition.z - pos.current.z)
      const greetDist = 1.5 // 打招呼触发距离（缩小范围）
      const resetDist = 3.0 // 离开后重置距离
      // 距离小于阈值就触发打招呼，不需要从远到近的条件
      if (dist < greetDist && !showGreet) {
        // 计算面向老板的朝向
        const dx = bossPosition.x - pos.current.x
        const dz = bossPosition.z - pos.current.z
        greetRotY.current = Math.atan2(dx, dz)
        setShowGreet(true)
      } else if (dist > resetDist && showGreet) {
        setShowGreet(false)
      }
      lastGreetDist.current = dist
    }

    // 打招呼状态变化时触发回调
    if (showGreet !== lastShowGreet.current) {
      lastShowGreet.current = showGreet
      onGreetChange?.(showGreet)
    }

    // 是否正在走路途中（用于姿势切换）
    let traveling = false

    // 打招呼时暂停移动，面向老板
    if (showGreet) {
      // 平滑转向老板
      let diff = greetRotY.current - pos.current.rotY
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      pos.current.rotY = damp(pos.current.rotY, pos.current.rotY + diff, 10, dt)
      root.current.position.set(pos.current.x, position[1], pos.current.z)
      root.current.rotation.y = pos.current.rotY
    } else if (freezeInPlace) {
      // 被串门：原地不动，转头面向来访者；不寻路、不回工位，交谈结束后从当前位置重新规划
      if (lookAt) {
        const dx = lookAt[0] - pos.current.x
        const dz = lookAt[2] - pos.current.z
        if (Math.hypot(dx, dz) > 0.01) {
          const targetRot = Math.atan2(dx, dz)
          let diff = targetRot - pos.current.rotY
          while (diff > Math.PI) diff -= Math.PI * 2
          while (diff < -Math.PI) diff += Math.PI * 2
          pos.current.rotY = damp(pos.current.rotY, pos.current.rotY + diff, 10, dt)
        }
      }
      // 重置寻路状态，解冻后从当前位置重新走向工位
      pathRef.current = []
      pathIdxRef.current = 0
      target.current = null
      lastDestRef.current = null
      root.current.position.set(pos.current.x, position[1], pos.current.z)
      root.current.rotation.y = pos.current.rotY
    } else if (
      (anim === 'typing' || anim === 'thinking' || anim === 'talking') &&
      Math.hypot(position[0] - pos.current.x, position[2] - pos.current.z) < 0.25
    ) {
      // 已到工位：钉住不动（避免“思考中还在走”）；未到工位时落到下方寻路分支先走过去
      pos.current.x = position[0]
      pos.current.z = position[2]
      let rdiff = rotationY - pos.current.rotY
      while (rdiff > Math.PI) rdiff -= Math.PI * 2
      while (rdiff < -Math.PI) rdiff += Math.PI * 2
      pos.current.rotY = damp(pos.current.rotY, pos.current.rotY + rdiff, 14, dt)
      // 重置寻路状态，避免下次切换时残留旧路径
      pathRef.current = []
      pathIdxRef.current = 0
      target.current = null
      lastDestRef.current = { x: position[0], z: position[2] }
      root.current.position.set(pos.current.x, position[1], pos.current.z)
      root.current.rotation.y = pos.current.rotY
    } else {
      // —— 正常位移：A* 寻路跟随路径 ——
      const isWalking = anim === 'walking'
      let goalX: number
      let goalZ: number

      if (isWalking) {
        // 漫步：随机选目标并寻路
        const [minX, maxX, minZ, maxZ] = wanderBounds
        if (!target.current) {
          const tx = minX + Math.random() * (maxX - minX)
          const tz = minZ + Math.random() * (maxZ - minZ)
          target.current = { x: tx, z: tz }
          if (walkGrid) {
            pathRef.current = findPath(pos.current.x, pos.current.z, tx, tz, walkGrid)
          } else {
            pathRef.current = [[tx, tz]]
          }
          pathIdxRef.current = 0
        }
        goalX = target.current.x
        goalZ = target.current.z
      } else {
        // 前往指定工位/座位
        const destX = position[0]
        const destZ = position[2]
        if (
          !lastDestRef.current ||
          Math.abs(lastDestRef.current.x - destX) > 0.01 ||
          Math.abs(lastDestRef.current.z - destZ) > 0.01
        ) {
          lastDestRef.current = { x: destX, z: destZ }
          if (walkGrid) {
            pathRef.current = findPath(pos.current.x, pos.current.z, destX, destZ, walkGrid)
          } else {
            pathRef.current = [[destX, destZ]]
          }
          pathIdxRef.current = 0
        }
        target.current = null
        goalX = destX
        goalZ = destZ
      }

      // 推进路径：已到达当前路点则切换到下一个
      const path = pathRef.current
      while (
        pathIdxRef.current < path.length &&
        Math.hypot(path[pathIdxRef.current][0] - pos.current.x, path[pathIdxRef.current][1] - pos.current.z) < 0.35
      ) {
        pathIdxRef.current++
      }
      const wayX = pathIdxRef.current < path.length ? path[pathIdxRef.current][0] : goalX
      const wayZ = pathIdxRef.current < path.length ? path[pathIdxRef.current][1] : goalZ

      const dx = wayX - pos.current.x
      const dz = wayZ - pos.current.z
      const dist = Math.hypot(dx, dz)
      // 距离终点还远时显示走路姿势
      traveling = !isWalking && Math.hypot(goalX - pos.current.x, goalZ - pos.current.z) > 0.12

      if (dist > 0.08) {
        // 先转向移动方向
        const targetRot = Math.atan2(dx / dist, dz / dist)
        let diff = targetRot - pos.current.rotY
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        pos.current.rotY = damp(pos.current.rotY, pos.current.rotY + diff, 12, dt)
        // 朝向偏差较大时先原地转身，转到基本面向目标（约 10°内）再前进
        if (Math.abs(diff) < 0.18) {
          // 回工位执行任务时走快些；其它移动普通速度；漫步最慢
          const isWorkRush = anim === 'typing' || anim === 'thinking' || anim === 'talking'
          const speed = isWalking ? 1.3 : isWorkRush ? 4.0 : 2.2
          const step = Math.min(speed * dt, dist)
          pos.current.x += (dx / dist) * step
          pos.current.z += (dz / dist) * step
        }
      } else if (isWalking) {
        // 到达漫步目标，下次重新选点
        target.current = null
        pathRef.current = []
        pathIdxRef.current = 0
      } else {
        // 已到达目的地，恢复工位朝向
        pos.current.rotY = damp(pos.current.rotY, rotationY, 14, dt)
      }
      root.current.position.set(pos.current.x, position[1], pos.current.z)
      root.current.rotation.y = pos.current.rotY
    }

    // 上报实时位置，供相机聚焦跟随移动中的助手
    if (agentId && agentPositionsRef) {
      agentPositionsRef.current[agentId] = { x: pos.current.x, z: pos.current.z }
    }

    // 目标姿势
    let bodyLean = 0
    let headPitch = 0
    let headRoll = 0
    let armLx = 0
    let armRx = 0
    let armRz = 0
    let legLx = 0
    let legRx = 0
    let legLz = 0
    let legRz = 0
    let bobY = 0
    let breathe = Math.sin(t * 2) * 0.02

    // 打招呼时使用挥手姿势，覆盖其他动画
    if (showGreet) {
      // 挥手姿势：站立，右手挥手
      headPitch = Math.sin(t * 1.5) * 0.04 // 头微微晃动
      armLx = 0.1 // 左手自然下垂
      armRx = -2.8 + Math.sin(t * 4) * 0.4 // 右手挥动
      armRz = 0.3 // 右手稍微向外
      breathe = Math.sin(t * 1.5) * 0.02
    } else {
      // 前往目的地途中统一走路姿势
      const poseKey: CharacterAnim = traveling ? 'walking' : anim

      switch (poseKey) {
      case 'idle': {
        headPitch = Math.sin(t * 1.5) * 0.04
        armLx = Math.sin(t * 1.2) * 0.06
        armRx = Math.sin(t * 1.2 + 0.5) * 0.06
        break
      }
      case 'typing': {
        bodyLean = 0.18
        headPitch = 0.32
        // 手肘抬起前伸到桌面，快速上下敲击
        armLx = -1.35 + Math.sin(t * 22) * 0.18
        armRx = -1.35 + Math.sin(t * 22 + Math.PI) * 0.18
        break
      }
      case 'thinking': {
        headRoll = 0.18
        headPitch = 0.1 + Math.sin(t * 1.2) * 0.03
        // 右手托腮
        armRx = -2.45
        armRz = 0.55
        armLx = 0.1
        breathe = Math.sin(t * 1.5) * 0.015
        break
      }
      case 'talking': {
        headPitch = Math.sin(t * 6) * 0.08
        // 双手轻微比划
        armLx = -0.6 + Math.sin(t * 5) * 0.3
        armRx = -0.6 + Math.sin(t * 5 + 1) * 0.3
        break
      }
      case 'walking': {
        legLx = Math.sin(t * 6) * 0.6
        legRx = Math.sin(t * 6 + Math.PI) * 0.6
        armLx = Math.sin(t * 6 + Math.PI) * 0.5
        armRx = Math.sin(t * 6) * 0.5
        headPitch = 0.05
        break
      }
      case 'sitting': {
        // 坐姿：大腿前伸，双手搭腿上，放松
        legLx = -1.45
        legRx = -1.45
        armLx = -0.2
        armRx = -0.2
        headPitch = Math.sin(t * 1.2) * 0.03
        breathe = Math.sin(t * 1.5) * 0.015
        break
      }
      case 'eating': {
        // 坐着吃东西：右手反复送到嘴边
        legLx = -1.45
        legRx = -1.45
        armLx = -0.2
        armRx = -1.5 + Math.sin(t * 3) * 0.9
        headPitch = 0.12
        break
      }
      case 'workout': {
        // 开合跳：双臂上下挥、双腿开合、整体上下弹跳
        const osc = (Math.sin(t * 7) + 1) / 2 // 0..1
        armLx = -3.0 * osc
        armRx = -3.0 * osc
        legLz = 0.4 * osc
        legRz = -0.4 * osc
        bobY = Math.abs(Math.sin(t * 7)) * 0.14
        breathe = Math.sin(t * 7) * 0.03
        break
      }
      case 'gaming': {
        // 坐着打游戏：双手前伸握手柄、快速小幅抖动，身体前倾盯屏幕、随兴奋轻微晃
        legLx = -1.45
        legRx = -1.45
        armLx = -1.0 + Math.sin(t * 12) * 0.12
        armRx = -1.0 + Math.sin(t * 12 + Math.PI) * 0.12
        headPitch = 0.2 + Math.sin(t * 2) * 0.03
        bodyLean = 0.12
        breathe = Math.sin(t * 2) * 0.02
        break
      }
      case 'sleeping': {
        // 躺姿：身体伸直（由 root 整体绕 X 轴放平），手臂自然放在身体两侧
        legLx = 0
        legRx = 0
        armLx = 0.06
        armRx = 0.06
        headPitch = 0.15 // 头略微前点，靠在枕头上
        headRoll = Math.sin(t * 0.8) * 0.02 // 轻微摇头
        breathe = Math.sin(t * 1.2) * 0.01 // 缓慢呼吸
        break
      }
    }
    }

    const L = 8 // 过渡速度
    body.current.scale.y = damp(body.current.scale.y, 1 + breathe, L, dt)
    body.current.rotation.x = damp(body.current.rotation.x, bodyLean, L, dt)
    head.current.rotation.x = damp(head.current.rotation.x, headPitch, L, dt)
    head.current.rotation.z = damp(head.current.rotation.z, headRoll, L, dt)
    armL.current.rotation.x = damp(armL.current.rotation.x, armLx, L, dt)
    armR.current.rotation.x = damp(armR.current.rotation.x, armRx, L, dt)
    armR.current.rotation.z = damp(armR.current.rotation.z, armRz, L, dt)
    armL.current.rotation.z = damp(armL.current.rotation.z, 0, L, dt)
    legL.current.rotation.x = damp(legL.current.rotation.x, legLx, L, dt)
    legR.current.rotation.x = damp(legR.current.rotation.x, legRx, L, dt)
    legL.current.rotation.z = damp(legL.current.rotation.z, legLz, L, dt)
    legR.current.rotation.z = damp(legR.current.rotation.z, legRz, L, dt)
    // 健身时的上下弹跳
    root.current.position.y = position[1] + bobY

    // 睡觉躺下：把整个身体绕 X 轴放平，沿 -Z 躺在床上、抬到床垫高度
    // 仅在到达床位（非行走途中、非打招呼）时生效
    const lyingDown = !showGreet && !traveling && anim === 'sleeping'
    // rotation.x 不会被每帧重置，可作为持久的“躺下进度”来源
    root.current.rotation.x = damp(root.current.rotation.x, lyingDown ? -Math.PI / 2 : 0, 6, dt)
    // 躺下进度 0(站立)→1(完全躺平)；用它驱动高度，避免上面每帧把 y 重置为 0 导致 damp 不累积
    const lieT = Math.min(1, Math.max(0, root.current.rotation.x / (-Math.PI / 2)))
    if (lieT > 0.001) {
      root.current.rotation.y = 0 // 沿 z 轴躺，和床的长边方向一致
      // 床面顶部约 0.64、身体半厚约 0.16 → 身体中心抬到 0.80 时底面正好贴在床面上
      root.current.position.y = position[1] + lieT * 0.8
    }
  })

  const skin = '#f1c9a5'
  const text = bubble || BUBBLE_EMOJI[anim]

  return (
    <group
      ref={root}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto'
      }}
    >
      {/* 选中光圈 */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.42, 0.55, 32]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.85} />
        </mesh>
      )}
      {/* 腿 */}
      <group ref={legL} position={[-0.12, 0.5, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow>
          <boxGeometry args={[0.18, 0.5, 0.18]} />
          <meshStandardMaterial color="#2b3550" />
        </mesh>
      </group>
      <group ref={legR} position={[0.12, 0.5, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow>
          <boxGeometry args={[0.18, 0.5, 0.18]} />
          <meshStandardMaterial color="#2b3550" />
        </mesh>
      </group>

      {/* 身体 */}
      <mesh ref={body} position={[0, 0.85, 0]} castShadow>
        <boxGeometry args={[0.5, 0.6, 0.32]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {/* 脖子（连接头与身体，避免直立时头身分离） */}
      <mesh position={[0, 1.23, 0]} castShadow>
        <boxGeometry args={[0.16, 0.16, 0.16]} />
        <meshStandardMaterial color={skin} />
      </mesh>

      {/* 左臂（肩部为枢轴） */}
      <group ref={armL} position={[-0.32, 1.1, 0]}>
        <mesh position={[0, -0.255, 0]} castShadow>
          <boxGeometry args={[0.14, 0.50, 0.14]} />
          <meshStandardMaterial color={color} />
        </mesh>
        <mesh position={[0, -0.58, 0]} castShadow>
          <boxGeometry args={[0.14, 0.14, 0.14]} />
          <meshStandardMaterial color={skin} />
        </mesh>
      </group>

      {/* 右臂 */}
      <group ref={armR} position={[0.32, 1.1, 0]}>
        <mesh position={[0, -0.255, 0]} castShadow>
          <boxGeometry args={[0.14, 0.50, 0.14]} />
          <meshStandardMaterial color={color} />
        </mesh>
        <mesh position={[0, -0.58, 0]} castShadow>
          <boxGeometry args={[0.14, 0.14, 0.14]} />
          <meshStandardMaterial color={skin} />
        </mesh>
      </group>

      {/* 头 */}
      <group ref={head} position={[0, 1.3, 0]}>
        <mesh position={[0, 0.18, 0]} castShadow>
          <boxGeometry args={[0.34, 0.34, 0.32]} />
          <meshStandardMaterial color={skin} />
        </mesh>
        {/* 头发 */}
        <mesh position={[0, 0.37, 0]} castShadow>
          <boxGeometry args={[0.37, 0.1, 0.35]} />
          <meshStandardMaterial color="#39271b" />
        </mesh>
        {/* 眼睛 */}
        <mesh position={[-0.08, 0.18, 0.19]}>
          <boxGeometry args={[0.05, 0.05, 0.02]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[0.08, 0.18, 0.19]}>
          <boxGeometry args={[0.05, 0.05, 0.02]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      </group>

      {/* 头顶气泡 + 名字 */}
      {(text || name || showGreet) && (
        <Html position={[0, firstPerson ? (showGreet ? 1.95 : 1.9) : (showGreet ? 2.15 : 2.05), 0]} center distanceFactor={firstPerson ? 4 : 6} zIndexRange={[20, 0]}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            {/* 打招呼气泡 */}
            {showGreet && (
              <div
                style={{
                  background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                  border: '2px solid #f59e0b',
                  borderRadius: 16,
                  padding: '4px 12px',
                  fontSize: 14,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 3px 8px rgba(245,158,11,0.3)',
                  color: '#92400e',
                  animation: 'bounce 0.5s ease-in-out',
                }}
              >
                {t('office.bossGreeting')}
              </div>
            )}
            {text && (
              <div
                style={{
                  background: 'rgba(255,255,255,0.95)',
                  border: '1px solid #e5e7eb',
                  borderRadius: 12,
                  padding: '3px 10px',
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                  color: '#374151',
                }}
              >
                {text}
              </div>
            )}
            {name && (
              <div
                style={{
                  background: effectiveColor,
                  color: '#fff',
                  borderRadius: 12,
                  padding: firstPerson ? '4px 12px' : '10px 28px',
                  fontSize: firstPerson ? 14 : 32,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 3px 10px rgba(0,0,0,0.2)',
                }}
              >
                {name}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}
