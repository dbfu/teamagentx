import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, ContactShadows, Html } from '@react-three/drei'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, HelpCircle, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { OfficeCharacter, type CharacterAnim } from './office-character'
import { DayNight } from './office-daylight'
import { RoomWithFloorTiles, Desk, Sofa, Plant, BossDesk, BossChair, Bookshelf, OfficeFurnitureItem, RoomWalls } from './office-furniture'
import { useOfficeRealAgents, ENTRANCE_TREES } from './use-office-real-agents'
import { OfficeChatHistory } from './office-chat-history'
import { OfficeMessageDetail } from './office-message-detail'
import { buildFullObstacles, isInRectObstacle, type Obstacle } from './office-obstacles'
import { buildWalkableGrid, findPath, type WalkGrid } from './office-pathfinding'
import { useSocketStore } from '@/stores/socket-store'
import { useChatRoomStore, useChatStore } from '@/stores'
import { useAuthStore } from '@/stores/auth-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { ChatInputArea } from '@/components/chat/chat-input-area'
import { AgentDetailPanel } from '@/components/chat/chat-side-panel/agent-detail-panel'
import { StreamPanel } from '@/components/chat/chat-side-panel/stream-panel'
import { TaskQueuePanel } from '@/components/chat/chat-side-panel/task-queue-panel'
import { HistoryPanel } from '@/components/chat/chat-side-panel/history-panel'
import { RecordDetailPanel } from '@/components/chat/chat-side-panel/record-detail-panel'
import { useAgentEventSubscription } from '@/stores/chat-store'
import { chatRoomApi, debugApi, type ExecutionRecord, type Message } from '@/lib/agent-api'
import { toast } from 'sonner'
import { AgentAvatarImage } from '@/lib/agent-avatars'

// 获取动画状态气泡文本（需要 t 函数）
function getAnimBubble(anim: CharacterAnim, t: (key: string) => string): string {
  const key = `office.animBubble.${anim}` as const
  const text = t(key)
  return text === key ? '' : text // 如果翻译不存在，返回空字符串
}

// 解析消息内容中 @ 到的助手名
function mentionedAgentNames(content: string, agentNames: string[]): string[] {
  const escaped = agentNames
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (escaped.length === 0) return []
  const re = new RegExp(`@(${escaped.join('|')})(?=\\s|$|[^\\u4e00-\\u9fa5a-zA-Z0-9_])`, 'g')
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m[1] && !found.includes(m[1])) found.push(m[1])
  }
  return found
}

// 老板人物组件（可控制移动）
function BossCharacter({
  walkGrid,
  obstacles,
  positionRef,
  rotationRef,
  disabled = false,
  orbitControlsRef,
  firstPerson = false,
  focusAgentIdRef,
  onMove,
  greetingAgentsRef,
  agentPositionsRef,
  stationsRef,
  bossOffice,
  mapBounds,
  translate,
}: {
  walkGrid: WalkGrid
  obstacles: Obstacle[]
  positionRef: React.MutableRefObject<{ x: number; z: number }>
  rotationRef: React.MutableRefObject<number>
  disabled?: boolean
  orbitControlsRef?: React.RefObject<any>
  firstPerson?: boolean
  focusAgentIdRef?: React.MutableRefObject<string | null>
  onMove?: () => void
  greetingAgentsRef?: React.MutableRefObject<string[]>
  agentPositionsRef?: React.MutableRefObject<Record<string, { x: number; z: number }>>
  stationsRef?: React.MutableRefObject<Record<string, { pos: [number, number, number]; rot: number }>>
  bossOffice: { cx: number; cz: number }
  mapBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  translate: (key: string) => string
}) {
  const rootRef = useRef<THREE.Group>(null)
  const bodyRef = useRef<THREE.Mesh>(null)
  const armLRef = useRef<THREE.Group>(null)
  const armRRef = useRef<THREE.Group>(null)
  const legLRef = useRef<THREE.Group>(null)
  const legRRef = useRef<THREE.Group>(null)
  // 初始位置在老板椅后面（bossOffice.cz + 2.5），避开障碍物
  const pos = useRef({ x: bossOffice.cx, z: bossOffice.cz + 2.5, rotY: Math.PI })
  const keys = useRef({ w: false, a: false, s: false, d: false })
  // 按住 J 鼓励：仅在有助手正在打招呼时生效，老板举臂并在头顶显示气泡
  const encourageKeyRef = useRef(false)
  const [encouraging, setEncouraging] = useState(false)
  // 鼓励动画的持续截止时间：触发时不断后顶，松开后仍保持一会儿再平滑结束
  const encourageUntil = useRef(0)
  // 鼓励气泡文案，按住时随机挑选一句，保持稳定不闪烁
  const encourageText = useRef(translate('office.encourage.default'))
  // 鼓励时自动走向打招呼助手的寻路状态
  const encPathRef = useRef<[number, number][]>([])
  const encPathIdxRef = useRef(0)
  const encRepathAt = useRef(0)
  // 是否已走到助手身边（到达后才举臂欢呼，行走途中只是走过去）
  const encArrived = useRef(false)

  useEffect(() => {
    if (disabled) {
      // 禁用时清空按键状态
      keys.current = { w: false, a: false, s: false, d: false }
      encourageKeyRef.current = false
      return
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框内，不处理移动按键
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.getAttribute('contenteditable') === 'true') {
        return
      }
      const key = e.key.toLowerCase()
      if (key === 'w' || key === 'arrowup') keys.current.w = true
      if (key === 'a' || key === 'arrowleft') keys.current.a = true
      if (key === 's' || key === 'arrowdown') keys.current.s = true
      if (key === 'd' || key === 'arrowright') keys.current.d = true
      if (key === 'j') encourageKeyRef.current = true
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === 'w' || key === 'arrowup') keys.current.w = false
      if (key === 'a' || key === 'arrowleft') keys.current.a = false
      if (key === 's' || key === 'arrowdown') keys.current.s = false
      if (key === 'd' || key === 'arrowright') keys.current.d = false
      if (key === 'j') encourageKeyRef.current = false
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [disabled])

  // 第一人称：左键拖拽控制朝向（鼠标转动视角）
  useEffect(() => {
    if (!firstPerson || disabled) return
    let dragging = false
    const onDown = (e: MouseEvent) => {
      // 仅左键，且不在 UI 元素（按钮/输入框/弹层）上时才进入拖拽
      if (e.button !== 0) return
      const el = e.target as HTMLElement | null
      if (el && el.closest('button, input, textarea, [role="dialog"]')) return
      dragging = true
    }
    const onMove = (e: MouseEvent) => {
      if (!dragging) return
      // 鼠标右移 → 视角右转（rotY 减小，与 A/D 一致）
      pos.current.rotY -= e.movementX * 0.0035
    }
    const onUp = () => { dragging = false }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [firstPerson, disabled])

  // 平滑过渡函数
  const damp = (current: number, target: number, lambda: number, dt: number) => {
    return current + (target - current) * (1 - Math.exp(-lambda * dt))
  }

  useFrame((state, delta) => {
    if (!rootRef.current) return
    const t = state.clock.elapsedTime
    const dt = Math.min(delta, 0.05)
    const k = keys.current

    // 鼓励：按住 J 且当前有助手正在打招呼时触发；触发时把截止时间往后顶，
    // 松开后仍保持约 1.2s 再结束，避免动画戛然而止
    const greeters = greetingAgentsRef?.current ?? []
    // 目标助手：最近一个打招呼的助手
    const greeterId = greeters.length > 0 ? greeters[greeters.length - 1] : null
    const triggering = encourageKeyRef.current && !!greeterId
    if (triggering) {
      if (!encouraging) {
        // 使用默认鼓励文案
        encourageText.current = translate('office.encourage.default')
      }
      encourageUntil.current = t + 1.2
    }
    const shouldEncourage = t < encourageUntil.current
    if (shouldEncourage !== encouraging) {
      setEncouraging(shouldEncourage)
    }
    // 鼓励彻底结束后重置到达状态与寻路
    if (!shouldEncourage) {
      encArrived.current = false
      encPathRef.current = []
    }

    // 老板用连续碰撞检测（直接判障碍矩形），避免格子量化造成的空气墙
    const BOSS_RADIUS = 0.25
    const bossWalkable = (x: number, z: number) =>
      !obstacles.some((o) => isInRectObstacle(x, z, o, BOSS_RADIUS))

    // 尝试移动到目标位置，碰撞时沿单轴滑动
    const tryMove = (nxRaw: number, nzRaw: number) => {
      // 先夹到地图边界内，防止走出地图（使用动态计算的边界）
      const nx = Math.max(mapBounds.minX, Math.min(mapBounds.maxX, nxRaw))
      const nz = Math.max(mapBounds.minZ, Math.min(mapBounds.maxZ, nzRaw))
      if (bossWalkable(nx, nz)) {
        pos.current.x = nx
        pos.current.z = nz
      } else if (bossWalkable(nx, pos.current.z)) {
        pos.current.x = nx
      } else if (bossWalkable(pos.current.x, nz)) {
        pos.current.z = nz
      }
    }

    let isMoving = false

    // 取助手世界坐标：优先实时位置，回退到工位坐标
    const greeterPos = greeterId
      ? agentPositionsRef?.current[greeterId]
        ?? (stationsRef?.current[greeterId]
          ? { x: stationsRef.current[greeterId].pos[0], z: stationsRef.current[greeterId].pos[2] }
          : null)
      : null

    if (triggering && greeterPos) {
      // 鼓励模式：走向打招呼助手并面向他（覆盖 WASD 控制）
      const STAND = 0.7 // 站在助手身边的距离（尽量贴近）
      const NEAR = 1.7  // 进入这个范围就开始举臂欢呼（与打招呼范围相当）
      const dxg = pos.current.x - greeterPos.x
      const dzg = pos.current.z - greeterPos.z
      const distG = Math.hypot(dxg, dzg) || 0.0001
      // 只要靠得够近就欢呼，不依赖能否精确走到站位（避免被桌椅挡住时永远不触发）
      encArrived.current = distG <= NEAR

      if (distG > STAND + 0.15) {
        // 还没贴近：沿路径走向助手身边的站位
        const standX = greeterPos.x + (dxg / distG) * STAND
        const standZ = greeterPos.z + (dzg / distG) * STAND
        // 每 0.4s 重算一次路径，跟随可能移动中的助手
        if (t > encRepathAt.current || encPathRef.current.length === 0) {
          encPathRef.current = walkGrid
            ? findPath(pos.current.x, pos.current.z, standX, standZ, walkGrid)
            : [[standX, standZ]]
          encPathIdxRef.current = 0
          encRepathAt.current = t + 0.4
        }
        const path = encPathRef.current
        while (
          encPathIdxRef.current < path.length &&
          Math.hypot(path[encPathIdxRef.current][0] - pos.current.x, path[encPathIdxRef.current][1] - pos.current.z) < 0.35
        ) {
          encPathIdxRef.current++
        }
        const wayX = encPathIdxRef.current < path.length ? path[encPathIdxRef.current][0] : standX
        const wayZ = encPathIdxRef.current < path.length ? path[encPathIdxRef.current][1] : standZ
        const wdx = wayX - pos.current.x
        const wdz = wayZ - pos.current.z
        const wd = Math.hypot(wdx, wdz)
        if (wd > 0.02) {
          const targetRot = Math.atan2(wdx / wd, wdz / wd)
          let diff = targetRot - pos.current.rotY
          while (diff > Math.PI) diff -= Math.PI * 2
          while (diff < -Math.PI) diff += Math.PI * 2
          pos.current.rotY += diff * 8 * dt
          const speed = 3.0
          const step = Math.min(speed * dt, wd)
          tryMove(pos.current.x + (wdx / wd) * step, pos.current.z + (wdz / wd) * step)
          isMoving = true
        }
      } else {
        // 已贴近：停下并面向助手
        encPathRef.current = []
        const targetRot = Math.atan2(greeterPos.x - pos.current.x, greeterPos.z - pos.current.z)
        let diff = targetRot - pos.current.rotY
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        pos.current.rotY += diff * 10 * dt
      }
    } else if (firstPerson) {
      // 第一人称：A/D 左右转身，W/S 前进/后退（沿当前朝向）
      const turnSpeed = 2.4
      if (k.a) pos.current.rotY += turnSpeed * dt
      if (k.d) pos.current.rotY -= turnSpeed * dt
      let move = 0
      if (k.w) move = 1
      if (k.s) move = -1
      if (move !== 0) {
        isMoving = true
        const fdx = Math.sin(pos.current.rotY)
        const fdz = Math.cos(pos.current.rotY)
        const speed = 3.2
        tryMove(
          pos.current.x + fdx * move * speed * dt,
          pos.current.z + fdz * move * speed * dt,
        )
      }
    } else {
      // 上帝视角：根据相机方位角计算移动方向
      // W: 向相机前方走，S: 向后，A: 向左，D: 向右
      const cameraAngle = orbitControlsRef?.current?.getAzimuthalAngle?.() ?? 0
      let forward = 0, right = 0
      if (k.w) forward = -1
      if (k.s) forward = 1
      if (k.a) right = -1
      if (k.d) right = 1

      // 将相机相对方向转换为世界坐标方向
      const cosAngle = Math.cos(cameraAngle)
      const sinAngle = Math.sin(cameraAngle)
      const dx = forward * sinAngle + right * cosAngle
      const dz = forward * cosAngle - right * sinAngle

      isMoving = dx !== 0 || dz !== 0
      if (isMoving) {
        const mag = Math.hypot(dx, dz)
        const ndx = dx / mag, ndz = dz / mag
        const targetRot = Math.atan2(ndx, ndz)
        let diff = targetRot - pos.current.rotY
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        pos.current.rotY += diff * 8 * dt

        const speed = 3.2
        tryMove(pos.current.x + ndx * speed * dt, pos.current.z + ndz * speed * dt)
      }
    }

    // 老板一移动就取消助手聚焦与选中，相机立即切回老板
    if (isMoving) {
      if (focusAgentIdRef?.current) focusAgentIdRef.current = null
      onMove?.()
    }

    rootRef.current.position.set(pos.current.x, 0, pos.current.z)
    rootRef.current.rotation.y = pos.current.rotY
    // 第一人称时隐藏老板自身模型，避免遮挡视野
    rootRef.current.visible = !firstPerson

    // 更新共享位置 / 朝向 ref，供助手检测距离与第一人称相机使用
    positionRef.current = { x: pos.current.x, z: pos.current.z }
    rotationRef.current = pos.current.rotY

    // 相机 target 由 CameraController 统一管理（跟随老板或聚焦选中助手），此处不再直接设置

    // 动画：走路时手脚摆动，静止时轻微呼吸
    const L = 8 // 过渡速度
    if (bodyRef.current && armLRef.current && armRRef.current && legLRef.current && legRRef.current) {
      if (isMoving) {
        // 走路动画：手脚摆动
        const walkSpeed = 6
        const legLx = Math.sin(t * walkSpeed) * 0.5
        const legRx = Math.sin(t * walkSpeed + Math.PI) * 0.5
        const armLx = Math.sin(t * walkSpeed + Math.PI) * 0.4
        const armRx = Math.sin(t * walkSpeed) * 0.4
        legLRef.current.rotation.x = damp(legLRef.current.rotation.x, legLx, L, dt)
        legRRef.current.rotation.x = damp(legRRef.current.rotation.x, legRx, L, dt)
        armLRef.current.rotation.x = damp(armLRef.current.rotation.x, armLx, L, dt)
        armRRef.current.rotation.x = damp(armRRef.current.rotation.x, armRx, L, dt)
        // 身体轻微上下起伏
        rootRef.current.position.y = Math.abs(Math.sin(t * walkSpeed)) * 0.08
      } else {
        // 静止动画：轻微呼吸
        const breathe = Math.sin(t * 2) * 0.02
        const armSwing = Math.sin(t * 1.2) * 0.05
        legLRef.current.rotation.x = damp(legLRef.current.rotation.x, 0, L, dt)
        legRRef.current.rotation.x = damp(legRRef.current.rotation.x, 0, L, dt)
        armLRef.current.rotation.x = damp(armLRef.current.rotation.x, armSwing, L, dt)
        armRRef.current.rotation.x = damp(armRRef.current.rotation.x, armSwing + 0.02, L, dt)
        if (bodyRef.current) {
          bodyRef.current.scale.y = damp(bodyRef.current.scale.y, 1 + breathe, L, dt)
        }
        rootRef.current.position.y = 0
      }
      // 走到助手身边后才双臂高举挥舞欢呼，覆盖上面的手臂动画（行走途中正常摆臂）
      if (shouldEncourage && encArrived.current) {
        const wave = Math.sin(t * 9) * 0.35
        armLRef.current.rotation.x = damp(armLRef.current.rotation.x, -2.6 + wave, L * 1.5, dt)
        armRRef.current.rotation.x = damp(armRRef.current.rotation.x, -2.6 - wave, L * 1.5, dt)
      }
    }
  })

  const skin = '#f1c9a5'

  return (
    <group ref={rootRef}>
      {/* 选中光圈 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.42, 0.55, 32]} />
        <meshBasicMaterial color="#ffd700" transparent opacity={0.85} />
      </mesh>

      {/* 腿 */}
      <group ref={legLRef} position={[-0.12, 0.5, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow>
          <boxGeometry args={[0.18, 0.5, 0.18]} />
          <meshStandardMaterial color="#1a1a2e" />
        </mesh>
      </group>
      <group ref={legRRef} position={[0.12, 0.5, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow>
          <boxGeometry args={[0.18, 0.5, 0.18]} />
          <meshStandardMaterial color="#1a1a2e" />
        </mesh>
      </group>

      {/* 身体 */}
      <mesh ref={bodyRef} position={[0, 0.85, 0]} castShadow>
        <boxGeometry args={[0.5, 0.6, 0.32]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>

      {/* 脖子（连接头与身体，避免直立时头身分离） */}
      <mesh position={[0, 1.23, 0]} castShadow>
        <boxGeometry args={[0.16, 0.16, 0.16]} />
        <meshStandardMaterial color={skin} />
      </mesh>

      {/* 左臂 */}
      <group ref={armLRef} position={[-0.32, 1.1, 0]}>
        <mesh position={[0, -0.255, 0]} castShadow>
          <boxGeometry args={[0.14, 0.50, 0.14]} />
          <meshStandardMaterial color="#1a1a2e" />
        </mesh>
        <mesh position={[0, -0.58, 0]} castShadow>
          <boxGeometry args={[0.14, 0.14, 0.14]} />
          <meshStandardMaterial color={skin} />
        </mesh>
      </group>

      {/* 右臂 */}
      <group ref={armRRef} position={[0.32, 1.1, 0]}>
        <mesh position={[0, -0.255, 0]} castShadow>
          <boxGeometry args={[0.14, 0.50, 0.14]} />
          <meshStandardMaterial color="#1a1a2e" />
        </mesh>
        <mesh position={[0, -0.58, 0]} castShadow>
          <boxGeometry args={[0.14, 0.14, 0.14]} />
          <meshStandardMaterial color={skin} />
        </mesh>
      </group>

      {/* 头 */}
      <group position={[0, 1.3, 0]}>
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

      {/* 头顶皇冠 */}
      <mesh position={[0, 2.0, 0]}>
        <sphereGeometry args={[0.08, 16, 12]} />
        <meshStandardMaterial color="#ffd700" emissive="#ffd700" emissiveIntensity={0.5} />
      </mesh>

      {/* 鼓励气泡 */}
      {encouraging && !firstPerson && (
        <Html position={[0, 2.35, 0]} center distanceFactor={6} zIndexRange={[20, 0]}>
          <div
            style={{
              background: 'linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%)',
              border: '2px solid #3b82f6',
              borderRadius: 16,
              padding: '4px 14px',
              fontSize: 14,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              boxShadow: '0 3px 8px rgba(59,130,246,0.35)',
              color: '#1e40af',
              pointerEvents: 'none',
              userSelect: 'none',
              animation: 'bounce 0.5s ease-in-out',
            }}
          >
            {encourageText.current}
          </div>
        </Html>
      )}
    </group>
  )
}

// 老板第一人称相机：跟随老板位置与朝向，置于视平线高度
function FirstPersonCamera({
  positionRef,
  rotationRef,
}: {
  positionRef: React.MutableRefObject<{ x: number; z: number }>
  rotationRef: React.MutableRefObject<number>
}) {
  const { camera } = useThree()
  const EYE_HEIGHT = 1.6

  useFrame(() => {
    const { x, z } = positionRef.current
    const rotY = rotationRef.current
    const fdx = Math.sin(rotY)
    const fdz = Math.cos(rotY)
    // 相机略微前移到头部前方，避免看到自己的身体
    camera.position.set(x + fdx * 0.18, EYE_HEIGHT, z + fdz * 0.18)
    camera.lookAt(x + fdx * 6, EYE_HEIGHT - 0.15, z + fdz * 6)
  })

  // 退出第一人称时，把相机摆回一个合理的俯视位置，交给 OrbitControls 接管
  useEffect(() => {
    return () => {
      const { x, z } = positionRef.current
      camera.position.set(x, 11, z + 11)
      camera.lookAt(x, 1, z)
    }
  }, [camera, positionRef])

  return null
}

// 相机控制器：上帝视角下平滑跟随老板，或聚焦到选中的助手；
// 聚焦时整体平移相机与 target，保持原有视角与距离，把目标人物带到画面中心。
function CameraController({
  orbitControlsRef,
  bossPositionRef,
  focusAgentIdRef,
  stationsRef,
  agentPositionsRef,
  firstPerson,
}: {
  orbitControlsRef: React.RefObject<any>
  bossPositionRef: React.MutableRefObject<{ x: number; z: number }>
  focusAgentIdRef: React.MutableRefObject<string | null>
  stationsRef: React.MutableRefObject<Record<string, { pos: [number, number, number]; rot: number }>>
  agentPositionsRef: React.MutableRefObject<Record<string, { x: number; z: number }>>
  firstPerson: boolean
}) {
  const { camera } = useThree()
  useFrame((_, delta) => {
    if (firstPerson) return
    const controls = orbitControlsRef.current
    if (!controls) return
    const focusId = focusAgentIdRef.current
    // 优先用助手实时位置，让相机平滑跟随移动中的助手；
    // 实时位置还没上报时回退到工位坐标，再没有则跟随老板
    const livePos = focusId ? agentPositionsRef.current[focusId] : null
    const focusStation = focusId ? stationsRef.current[focusId] : null
    const tx = livePos ? livePos.x : focusStation ? focusStation.pos[0] : bossPositionRef.current.x
    const ty = 1
    const tz = livePos ? livePos.z : focusStation ? focusStation.pos[2] : bossPositionRef.current.z
    const dt = Math.min(delta, 0.05)
    const f = 1 - Math.exp(-7 * dt)
    const dx = (tx - controls.target.x) * f
    const dy = (ty - controls.target.y) * f
    const dz = (tz - controls.target.z) * f
    // 同步平移 target 与相机，保持观察角度与距离
    controls.target.x += dx
    controls.target.y += dy
    controls.target.z += dz
    camera.position.x += dx
    camera.position.y += dy
    camera.position.z += dz
    controls.update()
  })
  return null
}

// 限帧器：Canvas 设为 frameloop="never"，由本组件按目标帧率驱动渲染，
// 避免按显示器刷新率（60/120Hz）全速渲染导致 GPU 持续高占用、机器发烫
function FrameLimiter({ fps }: { fps: number }) {
  const advance = useThree((s) => s.advance)
  useEffect(() => {
    let raf = 0
    let last = 0
    const interval = 1000 / fps
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      // 距上一帧达到目标间隔才渲染；留 1ms 余量避免 60fps 抖动丢帧
      if (t - last >= interval - 1) {
        last = t
        // frameloop="never" 下 R3F 把 advance 的入参当作「秒」来计算 delta，
        // 而 rAF 时间戳是毫秒，必须除以 1000，否则 delta 放大 1000 倍导致动作抽搐
        advance(t / 1000)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [fps, advance])
  return null
}

// 画质预设：影响渲染像素比、抗锯齿与阴影分辨率
type QualityLevel = 'low' | 'medium' | 'high' | 'ultra'
const QUALITY_PRESETS: Record<QualityLevel, {
  labelKey: string
  dpr: number | [number, number]
  antialias: boolean
  shadowMapSize: number
  shadows: boolean
  clouds: boolean
}> = {
  low: { labelKey: 'office.qualityLow', dpr: 1, antialias: false, shadowMapSize: 512, shadows: false, clouds: false },
  medium: { labelKey: 'office.qualityMedium', dpr: [1, 1.5], antialias: true, shadowMapSize: 1024, shadows: true, clouds: true },
  high: { labelKey: 'office.qualityHigh', dpr: [1, 2], antialias: true, shadowMapSize: 2048, shadows: true, clouds: true },
  // 超清：固定 dpr 做超采样（非 Retina 屏也强制高分辨率渲染），最清晰但很吃 GPU
  ultra: { labelKey: 'office.qualityUltra', dpr: 3, antialias: true, shadowMapSize: 4096, shadows: true, clouds: true },
}
// 下拉从上到下按清晰度从高到低排列
const QUALITY_ORDER: QualityLevel[] = ['ultra', 'high', 'medium', 'low']

// 渲染帧率固定 30（越低越省电、越凉快）
const DEFAULT_FPS = 30

export function OfficePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { chatRoomId } = useParams<{ chatRoomId: string }>()
  const isMobile = useIsMobile()
  // 桌面（Electron）端：顶栏需留出系统窗口按钮位置并支持拖拽
  const isDesktop = typeof window !== 'undefined' && !!(window as Window & { electronAPI?: unknown }).electronAPI
  // macOS 交通灯在左上、Windows 控制按钮在右上，分别留位
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
  const selectRoom = useChatRoomStore((s) => s.selectRoom)
  const currentUser = useAuthStore((s) => s.user)
  const { agents, states, outputs, stations, chatRoomName, furniture, floors, walls, bossOffice, mapBounds } = useOfficeRealAgents(chatRoomId || '')
  // 保存最新站位，供相机控制器实时聚焦正在移动的助手
  const stationsRef = useRef(stations)
  stationsRef.current = stations
  // 助手实时位置（由各 OfficeCharacter 每帧写入），供相机跟随移动中的助手
  const agentPositionsRef = useRef<Record<string, { x: number; z: number }>>({})
  // 助手串门：A @ 了 B 时，A 立刻走到 B 当前位置旁边交谈；B 原地不动，交谈结束后再回工位执行任务
  // visitorId -> { A 的站位 pos / 朝向 rot；被访者 id targetId }（被访者交谈期间由 freezeInPlace 钉在当前位置）
  const [visits, setVisits] = useState<Record<string, { pos: [number, number, number]; rot: number; targetId: string }>>({})
  const visitTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // 使用完整障碍物构建（包含动态家具）
  const obstacles = useMemo(
    () => buildFullObstacles(agents.map(a => ({ cx: a.deskFurniture[0], cz: a.deskFurniture[2] })), furniture),
    [agents, furniture],
  )
  const walkGrid = useMemo(() => buildWalkableGrid(obstacles), [obstacles])
  const isConnected = useSocketStore((state) => state.isConnected)
  const sendMessage = useSocketStore((state) => state.sendMessage)
  const joinChatRoom = useSocketStore((state) => state.joinChatRoom)
  const leaveChatRoom = useSocketStore((state) => state.leaveChatRoom)
  const onAgentStatus = useSocketStore((state) => state.onAgentStatus)
  const onMessage = useSocketStore((state) => state.onMessage)
  const requestAgentStatus = useSocketStore((state) => state.requestAgentStatus)
  const stopAgent = useSocketStore((state) => state.stopAgent)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const orbitControlsRef = useRef<any>(null)
  // 相机聚焦的助手 id（null 表示跟随老板）；按空格清除回到老板
  const focusAgentIdRef = useRef<string | null>(null)
  // 标记：本次选中助手是由「点击显示器」触发，选中后直接打开执行历史
  const openHistoryOnSelectRef = useRef(false)
  // 标记：本次选中助手是由「点击显示器」触发（助手执行中），选中后直接打开流式输出面板
  const openStreamOnSelectRef = useRef(false)
  // 第一人称（老板视角）开关
  const [firstPerson, setFirstPerson] = useState(false)
  // 画质等级（持久化到 localStorage）
  const [quality, setQuality] = useState<QualityLevel>(() => {
    const saved = localStorage.getItem('office-quality')
    return saved && (QUALITY_ORDER as string[]).includes(saved) ? (saved as QualityLevel) : 'high'
  })
  const preset = QUALITY_PRESETS[quality]
  const [showQualityMenu, setShowQualityMenu] = useState(false)
  // 渲染帧率固定 30（越低越省电、越凉快）
  const fps = DEFAULT_FPS
  // 昼夜切换：初始按真实时间判断，可手动切换白天/夜晚
  const [isNight, setIsNight] = useState(() => {
    const h = new Date().getHours()
    return h < 6 || h >= 19
  })
  const hour = isNight ? 22 : 13
  const changeQuality = (q: QualityLevel) => {
    setQuality(q)
    localStorage.setItem('office-quality', q)
    setShowQualityMenu(false)
  }

  // 订阅 agent 流式事件（与群聊侧栏共用同一套订阅），用于 3D 模式内查看执行过程
  useAgentEventSubscription(chatRoomId || null)
  const streamEvents = useChatStore((s) => s.streamEvents)
  const completedAgents = useChatStore((s) => s.completedAgents)
  const typingAgents = useChatStore((s) => s.typingAgents)
  const streamingViewAgent = useChatStore((s) => s.streamingViewAgent)
  const setStreamingViewAgent = useChatStore((s) => s.setStreamingViewAgent)
  const setSidePanelMode = useChatStore((s) => s.setSidePanelMode)

  // 从 useChatStore 获取更新方法和状态
  const setAgentStatuses = useChatStore((state) => state.setAgentStatuses)
  const agentStatuses = useChatStore((state) => state.agentStatuses)
  const setInputValue = useChatStore((state) => state.setInputValue)
  const inputDraft = useChatStore((s) => s.inputDraftsByRoom[chatRoomId || ''] ?? '')

  // 订阅群聊 socket 事件，获取助手状态更新
  useEffect(() => {
    if (!chatRoomId || !isConnected) return

    joinChatRoom(chatRoomId)
    requestAgentStatus(chatRoomId)

    // 订阅 agent 状态更新
    const unsubStatus = onAgentStatus((data) => {
      if (data.chatRoomId === chatRoomId) {
        const newStatuses = new Map(useChatStore.getState().agentStatuses)
        for (const [agentId, status] of Object.entries(data.statuses)) {
          newStatuses.set(agentId, status)
        }
        setAgentStatuses(newStatuses)
      }
    })

    return () => {
      leaveChatRoom(chatRoomId)
      unsubStatus()
    }
  }, [chatRoomId, isConnected, joinChatRoom, leaveChatRoom, onAgentStatus, requestAgentStatus, setAgentStatuses])

  // 监听消息：某助手 @ 了房间内另一个助手时，A 立刻去找 B（B 当前位置不动），交谈几秒后 A 回工位、B 再去工位执行任务
  useEffect(() => {
    const off = onMessage((msg) => {
      if (msg.chatRoomId !== chatRoomId) return
      if (!msg.agentId || msg.isHuman) return // 只处理助手发出的消息
      const fromId = msg.agentId
      const mentioned = mentionedAgentNames(msg.content || '', agents.map((a) => a.name))
      const target = agents.find((a) => a.id !== fromId && mentioned.includes(a.name))
      if (!target) return
      // B 当前位置（实时位置优先，回退到工位站位 / 工位坐标）；A 去找 B，B 原地不动
      const bStation = stationsRef.current[target.id]
      const bpos = agentPositionsRef.current[target.id]
        ?? (bStation ? { x: bStation.pos[0], z: bStation.pos[2] } : { x: target.deskFurniture[0], z: target.deskFurniture[2] })
      // A 站到 B 旁边：朝 A 当前所在方向偏移，避免穿过 B
      const apos = agentPositionsRef.current[fromId]
      let dirX = apos ? apos.x - bpos.x : 1
      let dirZ = apos ? apos.z - bpos.z : 0
      const len = Math.hypot(dirX, dirZ) || 1
      dirX /= len
      dirZ /= len
      const gap = 1.2
      const spotX = bpos.x + dirX * gap
      const spotZ = bpos.z + dirZ * gap
      const rot = Math.atan2(bpos.x - spotX, bpos.z - spotZ) // A 面向 B
      setVisits((prev) => ({
        ...prev,
        [fromId]: { pos: [spotX, 0, spotZ], rot, targetId: target.id },
      }))
      // 交谈结束：A 回工位，B 解除钉住后自行回工位执行任务
      clearTimeout(visitTimersRef.current[fromId])
      visitTimersRef.current[fromId] = setTimeout(() => {
        setVisits((prev) => {
          const next = { ...prev }
          delete next[fromId]
          return next
        })
        delete visitTimersRef.current[fromId]
      }, 5000)
    })
    return off
  }, [onMessage, chatRoomId, agents])

  // 卸载时清理串门定时器
  useEffect(() => () => {
    for (const t of Object.values(visitTimersRef.current)) clearTimeout(t)
  }, [])

  // 老板位置 ref，用于助手检测距离打招呼（初始在老板椅后面，避开障碍物）
  const bossPositionRef = useRef<{ x: number; z: number }>({ x: bossOffice.cx, z: bossOffice.cz + 2.5 })
  // 老板朝向 ref，用于第一人称相机
  const bossRotationRef = useRef<number>(Math.PI)

  // 打招呼的助手列表（按时间顺序，最后一个人在末尾）
  const greetingAgentsRef = useRef<string[]>([])
  // 强制停止打招呼状态（发送任务后使用）
  const [forceStopGreet, setForceStopGreet] = useState(false)
  // 输入框状态
  const [showTaskInput, setShowTaskInput] = useState(false)
  // 发送后冷却标记（防止 Enter 键再次打开输入框）
  const justSentRef = useRef(false)
  // 群助手列表浮层状态（点击顶部标题展开）
  const [showAgentList, setShowAgentList] = useState(false)
  // 操作说明浮层状态
  const [showHelp, setShowHelp] = useState(false)
  // 群聊历史浮层状态（左下角，支持 H 键开关）
  const [showChatHistory, setShowChatHistory] = useState(false)
  // 当前查看详情的群消息（右侧面板展示）
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  // 任务队列浮层状态（在 3D 模式内展示，不跳转群聊）
  const [showTaskQueue, setShowTaskQueue] = useState(false)
  // 执行历史浮层状态（在 3D 模式内展示，不跳转群聊）
  const [showHistory, setShowHistory] = useState(false)
  const [historyRecords, setHistoryRecords] = useState<ExecutionRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<ExecutionRecord | null>(null)

  // 将 agents 转换为 mentionAgents 格式
  const mentionAgents = useMemo(() => agents.map(a => ({
    id: a.id,
    name: a.name,
    avatar: a.avatar,
    avatarColor: a.color,
    description: null,
  })), [agents])

  // 处理打招呼状态变化
  const handleGreetChange = useCallback((agentId: string, isGreeting: boolean) => {
    const list = greetingAgentsRef.current
    if (isGreeting && !list.includes(agentId)) {
      // 添加到列表末尾（最后打招呼的人）
      greetingAgentsRef.current = [...list, agentId]
    } else if (!isGreeting) {
      // 从列表移除
      greetingAgentsRef.current = list.filter(id => id !== agentId)
    }
  }, [])

  // 监听回车键，弹出输入框
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC：任务框打开时直接关闭（无论焦点是否在输入框内）
      if (e.key === 'Escape' && showTaskInput) {
        e.preventDefault()
        setShowTaskInput(false)
        return
      }
      // 检查焦点是否在输入框内，避免冲突
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.getAttribute('contenteditable') === 'true') {
        return
      }
      // 发送后冷却期，不响应 Enter
      if (justSentRef.current) return
      if (e.code === 'Enter' && !showTaskInput) {
        e.preventDefault()
        setShowTaskInput(true)
        setShowAgentList(false)
        if (chatRoomId) {
          // 优先 @ 当前选中的助手，其次 @ 最后打招呼的助手，否则清空
          const lastGreetingId = greetingAgentsRef.current[greetingAgentsRef.current.length - 1]
          const targetAgent =
            (selectedId ? agents.find(a => a.id === selectedId) : null) ||
            (lastGreetingId ? agents.find(a => a.id === lastGreetingId) : null)
          setInputValue(targetAgent ? `@${targetAgent.name} ` : '', chatRoomId)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showTaskInput, agents, chatRoomId, setInputValue, selectedId])

  // Tab 切换助手面板并把相机聚焦到该助手；空格回到老板视角
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // 焦点在输入框 / 任务输入框打开时不处理，保留原生行为
      if (showTaskInput) return
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return
      }

      // 空格：相机回到当前老板
      if (e.code === 'Space') {
        e.preventDefault()
        focusAgentIdRef.current = null
        return
      }

      // H：开关左下角群聊历史
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault()
        setShowHelp(false)
        setShowAgentList(false)
        setShowChatHistory((v) => !v)
        return
      }

      // V：切换第一人称（老板视角）/ 第三人称（全局视角），游戏常用 V 切视角
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        setFirstPerson((v) => !v)
        return
      }

      // ?：开关操作说明（通用的“帮助/快捷键”快捷键）
      if (e.key === '?') {
        e.preventDefault()
        setShowAgentList(false)
        setShowChatHistory(false)
        setShowHelp((v) => !v)
        return
      }


      // Tab / Shift+Tab：在助手之间循环切换并聚焦
      if (e.key === 'Tab') {
        if (agents.length === 0) return
        e.preventDefault()
        const curIdx = agents.findIndex((a) => a.id === selectedId)
        const dir = e.shiftKey ? -1 : 1
        // 未选中时：Tab 选第一个，Shift+Tab 选最后一个
        const nextIdx = curIdx === -1
          ? (dir === 1 ? 0 : agents.length - 1)
          : (curIdx + dir + agents.length) % agents.length
        const nextId = agents[nextIdx].id
        setSelectedId(nextId)
        focusAgentIdRef.current = nextId
        setFirstPerson(false) // Tab 切换助手时退出老板视角，让相机聚焦
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [agents, selectedId, showTaskInput, chatRoomId])

  // 发送任务给助手
  const handleSendTask = useCallback(() => {
    const content = inputDraft.trim()

    // 先关闭输入框并设置冷却标记
    setShowTaskInput(false)
    justSentRef.current = true
    // 500ms 后解除冷却
    setTimeout(() => { justSentRef.current = false }, 500)

    if (!content || !chatRoomId) {
      setInputValue('', chatRoomId)
      return
    }

    console.log('[OfficePage] 发送任务:', {
      chatRoomId,
      content,
    })
    sendMessage({
      chatRoomId,
      content,
    })

    // 强制关闭打招呼状态，让助手回到工作岗位
    setForceStopGreet(true)
    // 清空打招呼列表
    greetingAgentsRef.current = []
    // 清空输入框
    setInputValue('', chatRoomId)

    // 3秒后恢复打招呼检测（助手离开后可以重新打招呼）
    setTimeout(() => setForceStopGreet(false), 3000)
  }, [inputDraft, chatRoomId, sendMessage, setInputValue])

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendTask()
    }
    if (e.key === 'Escape') {
      setShowTaskInput(false)
      setInputValue('', chatRoomId)
    }
  }, [handleSendTask, chatRoomId, setInputValue])

  // 获取选中的助手信息（包含更多详情用于面板）
  const selected = agents.find((a) => a.id === selectedId) || null
  const selectedAgentStatus = selectedId ? agentStatuses.get(selectedId) : undefined

  // 获取选中助手的完整信息（从 chatRoomAgents 获取 chatRoomAgentId、agentType 等）
  const [selectedRoomAgent, setSelectedRoomAgent] = useState<{
    id: string
    name: string
    avatar?: string | null
    avatarColor?: string | null
    description?: string | null
    chatRoomAgentId?: string
    agentType?: string
    agentLevel?: string
    chatRoomId?: string
    injectGroupHistory?: boolean
  } | null>(null)

  // 执行记录相关状态
  const [executionRecords, setExecutionRecords] = useState<any[]>([])

  // 加载选中助手的完整信息
  useEffect(() => {
    if (!selectedId || !chatRoomId) {
      setSelectedRoomAgent(null)
      return
    }
    chatRoomApi.getById(chatRoomId)
      .then(res => {
        if (res.data?.chatRoomAgents) {
          const cra = res.data.chatRoomAgents.find(c => c.agentId === selectedId || c.agent?.id === selectedId)
          if (cra?.agent) {
            setSelectedRoomAgent({
              id: cra.agent.id,
              name: cra.agent.name,
              avatar: cra.agent.avatar,
              avatarColor: cra.agent.avatarColor,
              description: cra.agent.description,
              chatRoomAgentId: cra.id,
              agentType: cra.agent.type,
              agentLevel: cra.agent.agentLevel,
              chatRoomId: chatRoomId,
              injectGroupHistory: cra.injectGroupHistory,
            })
          }
        }
      })
      .catch(err => console.error('Failed to load agent details:', err))
  }, [selectedId, chatRoomId])

  // 加载执行记录（简化版，只检查是否有记录）
  useEffect(() => {
    if (!selectedId || !chatRoomId) return
    debugApi.getExecutionRecords(chatRoomId, selectedId, 1)
      .then(res => {
        if (res.success && res.data) {
          setExecutionRecords(res.data)
        }
      })
      .catch(err => console.error('Failed to check execution records:', err))
  }, [selectedId, chatRoomId])

  // 查看历史执行结果（在 3D 模式内用浮层展示，不跳转群聊）
  const handleViewHistory = useCallback((agentId?: string) => {
    const id = (typeof agentId === 'string' ? agentId : null) ?? selectedId
    if (!id || !chatRoomId) return
    setSelectedHistoryRecord(null)
    setShowHistory(true)
    setHistoryLoading(true)
    debugApi.getExecutionRecords(chatRoomId, id, 20)
      .then((res) => {
        if (res.success && res.data) {
          setHistoryRecords(res.data)
        }
      })
      .catch((err) => console.error('Failed to load execution records:', err))
      .finally(() => setHistoryLoading(false))
  }, [selectedId, chatRoomId])

  // 查看当前执行任务（在 3D 模式内用浮层展示流式过程，不跳转群聊）
  const handleViewStream = useCallback((agentId?: string) => {
    const id = (typeof agentId === 'string' ? agentId : null) ?? selectedId
    if (!id) return
    // 找到该助手正在执行的触发消息 id：优先从 typingAgents，其次从 streamEvents 的 key 反查
    let messageId: string | undefined
    for (const [mid, list] of typingAgents) {
      if (list.some((a) => a.agentId === id)) {
        messageId = mid
        break
      }
    }
    if (!messageId) {
      const suffix = `_${id}`
      for (const key of streamEvents.keys()) {
        if (key.endsWith(suffix)) {
          messageId = key.slice(0, key.length - suffix.length)
          break
        }
      }
    }
    if (!messageId) {
      toast(t('office.noExecutingTask'))
      return
    }
    const name = agents.find((a) => a.id === id)?.name || t('chat.assistant')
    setStreamingViewAgent({ messageId, agentId: id, name })
    setSidePanelMode('stream')
  }, [selectedId, agents, typingAgents, streamEvents, setStreamingViewAgent, setSidePanelMode])

  // 关闭流式浮层
  const handleCloseStream = useCallback(() => {
    setStreamingViewAgent(null)
    setSidePanelMode(null)
  }, [setStreamingViewAgent, setSidePanelMode])

  // 离开 3D 页面时清理流式查看状态，避免影响群聊侧栏
  useEffect(() => {
    return () => {
      setStreamingViewAgent(null)
      setSidePanelMode(null)
    }
  }, [setStreamingViewAgent, setSidePanelMode])

  // 切换/取消选中助手时收起任务队列和历史浮层；
  // 若本次选中来自点击显示器，则直接打开执行历史
  useEffect(() => {
    setShowTaskQueue(false)
    setSelectedHistoryRecord(null)
    // 选中助手时关闭消息详情，避免右侧浮层重叠
    if (selectedId) setSelectedMessage(null)
    if (openStreamOnSelectRef.current && selectedId) {
      openStreamOnSelectRef.current = false
      handleViewStream(selectedId)
    } else if (openHistoryOnSelectRef.current && selectedId) {
      openHistoryOnSelectRef.current = false
      handleViewHistory(selectedId)
    } else {
      setShowHistory(false)
    }
  }, [selectedId, handleViewHistory, handleViewStream])

  // 点击群消息查看详情：右侧展示，关闭其它右侧浮层
  const handleSelectMessage = useCallback((message: Message) => {
    setSelectedMessage(message)
    setSelectedId(null)
    setShowTaskQueue(false)
    setShowHistory(false)
    setStreamingViewAgent(null)
    setSidePanelMode(null)
  }, [setStreamingViewAgent, setSidePanelMode])

  // 查看任务队列（在 3D 模式内用浮层展示，不跳转群聊）
  const handleViewTaskQueue = useCallback(() => {
    setShowTaskQueue(true)
  }, [])

  // 从任务队列点击正在执行的任务，切换到流式浮层
  const handleViewStreamFromQueue = useCallback((messageId: string, agentId: string, agentName: string) => {
    setShowTaskQueue(false)
    setStreamingViewAgent({ messageId, agentId, name: agentName })
    setSidePanelMode('stream')
  }, [setStreamingViewAgent, setSidePanelMode])

  // 分配任务给当前选中的助手
  const handleAssignTask = useCallback(() => {
    if (!selectedRoomAgent || !chatRoomId) return
    // 打开输入框并预填 @助手名
    setShowTaskInput(true)
    setInputValue(`@${selectedRoomAgent.name} `, chatRoomId)
  }, [selectedRoomAgent, chatRoomId, setInputValue])

  // 助手设置变更
  const handleAgentSettingsChange = useCallback((settings: { injectGroupHistory: boolean }) => {
    if (selectedRoomAgent) {
      setSelectedRoomAgent({
        ...selectedRoomAgent,
        injectGroupHistory: settings.injectGroupHistory,
      })
    }
    toast.success(settings.injectGroupHistory ? t('office.groupHistoryEnabled') : t('office.groupHistoryDisabled'))
  }, [selectedRoomAgent, t])

  return (
    <div
      className="relative h-full w-full"
      style={{ background: 'linear-gradient(175deg, #e4dccb 0%, #efe8da 45%, #fbf8f2 100%)' }}
    >
      {/* 顶部（桌面端可拖拽窗口，按钮 no-drag；左侧给 macOS 交通灯留位） */}
      <div
        className="absolute left-0 right-0 top-0 z-10 flex items-center gap-3 px-4 py-3 [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag]"
        style={{
          // 仅 macOS 桌面端隐藏标题栏：留交通灯位 + 可拖拽；Windows 用原生标题栏无需处理
          WebkitAppRegion: isDesktop && isMac ? 'drag' : undefined,
          paddingLeft: isDesktop && isMac ? 84 : undefined,
        } as React.CSSProperties}
      >
        <button
          onClick={() => {
            // 桌面端导航到根路径并选中群聊，移动端导航到聊天详情页
            if (isMobile) {
              navigate(`/chat/${chatRoomId}`)
            } else {
              if (chatRoomId) {
                selectRoom(chatRoomId)
              }
              navigate('/')
            }
          }}
          className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 text-sm text-gray-600 backdrop-blur hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" /> {t('office.returnToChat')}
        </button>
        <button
          onClick={() => { setShowHelp(false); setShowChatHistory(false); setShowAgentList((v) => !v) }}
          className="flex items-center gap-1 rounded-lg bg-white/80 px-3 py-1.5 text-sm font-medium text-gray-700 backdrop-blur hover:bg-white"
        >
          {chatRoomName || t('office.title')} · {t('office.agentsCount', { count: agents.length })}
          <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${showAgentList ? 'rotate-180' : ''}`} />
        </button>
        {/* 视角切换 */}
        <button
          onClick={() => setFirstPerson((v) => !v)}
          title={t('office.toggleViewTooltip')}
          className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 text-sm text-gray-600 backdrop-blur hover:bg-gray-50"
        >
          {t('office.viewMode', { mode: firstPerson ? t('office.globalView') : t('office.bossView') })}
        </button>
        {/* 画质切换 */}
        <div className="relative">
          <button
            onClick={() => setShowQualityMenu((v) => !v)}
            title={t('office.toggleQualityTooltip')}
            className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 text-sm text-gray-600 backdrop-blur hover:bg-gray-50"
          >
            {t('office.quality')}·{t(preset.labelKey)}
            <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${showQualityMenu ? 'rotate-180' : ''}`} />
          </button>
          {showQualityMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowQualityMenu(false)} />
              <div className="absolute left-0 top-full z-50 mt-1 w-32 overflow-hidden rounded-lg border border-gray-200 bg-white/95 shadow-lg backdrop-blur">
                {QUALITY_ORDER.map((q) => (
                  <button
                    key={q}
                    onClick={() => changeQuality(q)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      quality === q
                        ? 'bg-blue-50 font-medium text-blue-600'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t(QUALITY_PRESETS[q].labelKey)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* 白天/夜晚切换 */}
        <button
          onClick={() => setIsNight((v) => !v)}
          title={t('office.toggleDayNightTooltip')}
          className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 text-sm text-gray-600 backdrop-blur hover:bg-gray-50"
        >
          {isNight ? t('office.night') : t('office.day')}
        </button>
        {/* 群聊历史 */}
        <button
          onClick={() => { setShowHelp(false); setShowAgentList(false); setShowChatHistory((v) => !v) }}
          title={t('office.chatHistoryTooltip')}
          className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm backdrop-blur ${
            showChatHistory
              ? 'border-amber-300 bg-amber-100 text-amber-700'
              : 'border-gray-200 bg-white/80 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <MessageSquare className="h-4 w-4" /> {t('office.chatHistoryTitle')}
        </button>
        {/* 操作说明 */}
        <button
          onClick={() => { setShowAgentList(false); setShowChatHistory(false); setShowHelp((v) => !v) }}
          title={t('office.helpTooltip')}
          className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 text-sm text-gray-600 backdrop-blur hover:bg-gray-50"
        >
          <HelpCircle className="h-4 w-4" /> {t('office.help')}
        </button>
      </div>

      {/* 群助手列表浮层（点击顶部标题展开，风格与助手面板一致） */}
      {showAgentList && (
        <div className="absolute left-4 top-16 z-50 flex w-72 max-h-[calc(100vh-96px)] flex-col overflow-hidden rounded-xl border border-amber-200 bg-amber-50/95 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between border-b border-amber-100 px-4 py-2">
            <span className="text-sm font-medium text-amber-800">{t('office.agentListTitle', { count: agents.length })}</span>
            <button
              onClick={() => setShowAgentList(false)}
              className="rounded-md px-2 py-1 text-amber-700 hover:bg-amber-100"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
            {agents.length === 0 ? (
              <div className="py-6 text-center text-sm text-amber-700/70">{t('office.noAgents')}</div>
            ) : (
              agents.map((agent) => {
                const status = agentStatuses.get(agent.id)
                const dot =
                  status === 'executing' ? 'bg-green-500'
                    : status === 'busy' ? 'bg-orange-500'
                      : 'bg-amber-400/50'
                const label =
                  status === 'executing' ? t('office.statusExecuting')
                    : status === 'busy' ? t('office.statusBusy')
                      : t('office.statusIdle')
                return (
                  <button
                    key={agent.id}
                    onClick={() => {
                      setSelectedId(agent.id)
                      focusAgentIdRef.current = agent.id
                      setFirstPerson(false) // 选助手时退出老板视角，让相机聚焦到该助手
                      setShowAgentList(false)
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                      selectedId === agent.id ? 'bg-amber-100' : 'hover:bg-amber-100/60'
                    }`}
                  >
                    <AgentAvatarImage avatar={agent.avatar} className="size-8 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-amber-900">{agent.name}</div>
                      <div className="flex items-center gap-1">
                        <span className={`size-2 rounded-full ${dot}`} />
                        <span className="text-xs text-amber-700/70">{label}</span>
                      </div>
                    </div>
                    {/* @按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowAgentList(false)
                        setShowTaskInput(true)
                        setInputValue(`@${agent.name} `, chatRoomId)
                      }}
                      className="rounded-md px-2 py-1 text-xs text-amber-600 hover:bg-amber-200"
                    >
                      @
                    </button>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* 连接状态提示 */}
      {!isConnected && (
        <div className="absolute bottom-20 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-red-100 px-4 py-2 text-sm text-red-600">
          {t('office.socketDisconnected')}
        </div>
      )}

      <Canvas
        key={quality}
        frameloop="never"
        shadows={preset.shadows}
        dpr={preset.dpr}
        camera={{ position: [0, 12, 12], fov: 48 }}
        gl={{ alpha: true, antialias: preset.antialias }}
      >
        <FrameLimiter fps={fps} />
        <DayNight hour={hour} shadowMapSize={preset.shadowMapSize} shadows={preset.shadows} floors={floors} />
        <RoomWithFloorTiles floors={floors} />
        <RoomWalls walls={walls} />

        {/* 老板办公室 - 使用动态网格位置 bossOffice */}
        <BossDesk position={[bossOffice.cx, 0, bossOffice.cz - 0.5]} rotationY={Math.PI} />
        <BossChair position={[bossOffice.cx, 0, bossOffice.cz + 1]} rotationY={Math.PI} />
        <Sofa position={[bossOffice.cx - 3, 0, bossOffice.cz]} width={3} rotationY={Math.PI / 2} />
        <Bookshelf position={[bossOffice.cx + 3, 0, bossOffice.cz + 1.5]} rotationY={Math.PI / 2} />
        <Plant position={[bossOffice.cx - 3, 0, bossOffice.cz - 3]} />
        <Plant position={[bossOffice.cx + 3, 0, bossOffice.cz - 3]} />

        {/* 活动房间（茶水间 / 健身房 / 休息室 / 娱乐室）：人多时整间复制，统一渲染家具 */}
        {furniture.map((item, i) => (
          <OfficeFurnitureItem key={i} item={item} />
        ))}

        {/* 入口绿植（位置与办公区地面范围共用 ENTRANCE_TREES，确保树脚下是淡色房间地砖） */}
        {ENTRANCE_TREES.map((pos, i) => (
          <Plant key={i} position={pos} />
        ))}

        {/* 真实助手 */}
        {agents.map((agent) => {
          const baseAnim = states[agent.id]
          const station = stations[agent.id]
          // 串门中：A 走到 B 旁边交谈；B 转头面向来访者一起交谈
          const visit = visits[agent.id] // 本助手是来访者
          const incoming = Object.values(visits).find((v) => v.targetId === agent.id) // 本助手被串门
          let charPos = station.pos
          let charRot = station.rot
          let anim = baseAnim
          let bubbleOverride: string | undefined
          // 被串门时原地钉住、转头看向来访者；交谈结束后再回工位执行任务
          let freezeInPlace = false
          let lookAt: [number, number, number] | undefined
          if (visit) {
            charPos = visit.pos
            charRot = visit.rot
            anim = 'talking'
            bubbleOverride = '交谈中…'
          } else if (incoming) {
            // 被串门：留在当前位置不动（不寻路、不回工位），转向来访者一起交谈
            freezeInPlace = true
            lookAt = incoming.pos
            anim = 'talking'
            bubbleOverride = '交谈中…'
          }
          return (
            <group key={agent.id}>
              <Desk
                position={agent.deskFurniture}
                screenText={outputs[agent.id]}
                name={agent.name}
                onScreenClick={() => {
                  // 点击显示器：选中该助手。助手执行中直接进流式输出面板，否则打开执行历史
                  focusAgentIdRef.current = agent.id
                  setFirstPerson(false)
                  const status = agentStatuses.get(agent.id)
                  const working = status === 'executing' || status === 'busy'
                  if (selectedId === agent.id) {
                    // 已选中：effect 不会触发，直接打开对应面板
                    if (working) handleViewStream(agent.id)
                    else handleViewHistory(agent.id)
                  } else {
                    // 选中后由 effect 打开对应面板
                    if (working) openStreamOnSelectRef.current = true
                    else openHistoryOnSelectRef.current = true
                    setSelectedId(agent.id)
                  }
                }}
              />
              <OfficeCharacter
                position={charPos}
                rotationY={charRot}
                anim={anim}
                color={agent.color}
                name={agent.name}
                bubble={bubbleOverride ?? getAnimBubble(anim, t)}
                selected={selectedId === agent.id}
                onClick={() => {
                  setSelectedId(agent.id)
                  focusAgentIdRef.current = agent.id
                  setFirstPerson(false) // 选助手时退出老板视角，让相机聚焦到该助手
                }}
                agentId={agent.id}
                agentPositionsRef={agentPositionsRef}
                freezeInPlace={freezeInPlace}
                lookAt={lookAt}
                walkGrid={walkGrid}
                bossPositionRef={bossPositionRef}
                onGreetChange={(isGreeting) => handleGreetChange(agent.id, isGreeting)}
                forceStopGreet={forceStopGreet}
                firstPerson={firstPerson}
              />
            </group>
          )
        })}

        {/* 老板 */}
        <BossCharacter
          walkGrid={walkGrid}
          obstacles={obstacles}
          positionRef={bossPositionRef}
          rotationRef={bossRotationRef}
          disabled={showTaskInput}
          orbitControlsRef={orbitControlsRef}
          firstPerson={firstPerson}
          focusAgentIdRef={focusAgentIdRef}
          onMove={() => setSelectedId(null)}
          greetingAgentsRef={greetingAgentsRef}
          agentPositionsRef={agentPositionsRef}
          stationsRef={stationsRef}
          bossOffice={bossOffice}
          mapBounds={mapBounds}
          translate={t}
        />

        <ContactShadows position={[0, 0.02, 0]} opacity={0.3} scale={22} blur={2.2} far={8} frames={1} />
        {/* 相机统一控制：跟随老板或聚焦选中助手 */}
        <CameraController
          orbitControlsRef={orbitControlsRef}
          bossPositionRef={bossPositionRef}
          focusAgentIdRef={focusAgentIdRef}
          stationsRef={stationsRef}
          agentPositionsRef={agentPositionsRef}
          firstPerson={firstPerson}
        />
        {firstPerson ? (
          <FirstPersonCamera positionRef={bossPositionRef} rotationRef={bossRotationRef} />
        ) : (
          <OrbitControls
            ref={orbitControlsRef}
            target={[0, 1, 1]}
            mouseButtons={{
              LEFT: THREE.MOUSE.ROTATE,
              MIDDLE: THREE.MOUSE.DOLLY,
              RIGHT: undefined,
            }}
            enablePan={false}
            zoomSpeed={0.3}
            minDistance={2}
            maxDistance={35}
            minPolarAngle={0.15}
            maxPolarAngle={Math.PI / 2.05}
          />
        )}
      </Canvas>

      {/* 当前执行任务的流式浮层（在 3D 模式内展示，不跳转群聊） */}
      {streamingViewAgent && (
        <div className="absolute right-4 top-16 bottom-24 z-50 flex w-96 flex-col overflow-hidden rounded-xl border border-amber-200 bg-amber-50/95 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between border-b border-amber-100 px-4 py-2">
            <span className="text-sm font-medium text-amber-800">
              {streamingViewAgent.name} · 执行过程
            </span>
            <button
              onClick={handleCloseStream}
              className="rounded-md px-2 py-1 text-amber-700 hover:bg-amber-100"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <StreamPanel
              streamingViewAgent={streamingViewAgent}
              completedAgents={completedAgents}
              streamEvents={streamEvents}
              chatRoomId={chatRoomId}
              onStop={(agentId, messageId) => {
                if (chatRoomId) stopAgent(chatRoomId, agentId, messageId)
              }}
            />
          </div>
        </div>
      )}

      {/* 任务队列浮层（在 3D 模式内展示，不跳转群聊） */}
      {selected && selectedRoomAgent && showTaskQueue && !streamingViewAgent && (
        <div className="absolute right-4 top-16 bottom-24 z-50 w-80 overflow-auto rounded-xl border border-amber-200 bg-amber-50/95 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between border-b border-amber-100 px-4 py-2">
            <span className="text-sm font-medium text-amber-800">
              {selectedRoomAgent.name} · 任务队列
            </span>
            <button
              onClick={() => setShowTaskQueue(false)}
              className="rounded-md px-2 py-1 text-amber-700 hover:bg-amber-100"
            >
              ✕
            </button>
          </div>
          <div className="p-4">
            <TaskQueuePanel
              chatRoomId={chatRoomId || ''}
              agentId={selectedRoomAgent.id}
              agentStatus={selectedAgentStatus}
              onViewStream={handleViewStreamFromQueue}
            />
          </div>
        </div>
      )}

      {/* 执行历史浮层（在 3D 模式内展示，不跳转群聊） */}
      {selected && selectedRoomAgent && showHistory && !streamingViewAgent && (
        <div className="absolute right-4 top-16 bottom-24 z-50 flex w-80 flex-col overflow-hidden rounded-xl border border-amber-200 bg-amber-50/95 shadow-lg backdrop-blur">
          <div className="flex shrink-0 items-center justify-between border-b border-amber-100 px-4 py-2">
            <div className="flex items-center gap-2">
              {selectedHistoryRecord && (
                <button
                  onClick={() => setSelectedHistoryRecord(null)}
                  className="rounded-md px-1.5 py-1 text-amber-700 hover:bg-amber-100"
                  title="返回列表"
                >
                  ‹
                </button>
              )}
              <span className="text-sm font-medium text-amber-800">
                {selectedRoomAgent.name} · {selectedHistoryRecord ? '执行详情' : '执行历史'}
              </span>
            </div>
            <button
              onClick={() => {
                setShowHistory(false)
                setSelectedHistoryRecord(null)
              }}
              className="rounded-md px-2 py-1 text-amber-700 hover:bg-amber-100"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {selectedHistoryRecord ? (
              <RecordDetailPanel selectedRecord={selectedHistoryRecord} />
            ) : (
              <HistoryPanel
                recordsLoading={historyLoading}
                executionRecords={historyRecords}
                onSelectRecord={setSelectedHistoryRecord}
              />
            )}
          </div>
        </div>
      )}

      {/* 点击助手弹出的面板（使用和群聊一致的 AgentDetailPanel） */}
      {selected && selectedRoomAgent && !streamingViewAgent && !showTaskQueue && !showHistory && (
        <div className="absolute right-4 top-16 bottom-24 z-50 w-80 rounded-xl border border-amber-200 bg-amber-50/95 shadow-lg backdrop-blur overflow-auto">
          <div className="p-4">
            {/* 关闭按钮 */}
            <button
              onClick={() => setSelectedId(null)}
              className="absolute right-3 top-3 rounded-md px-2 py-1 text-amber-700 hover:bg-amber-100"
            >
              ✕
            </button>
            <AgentDetailPanel
              chatRoomId={chatRoomId || ''}
              selectedRoomAgent={selectedRoomAgent}
              agentStatus={selectedAgentStatus}
              hasExecutionRecords={executionRecords.length > 0}
              onViewHistory={handleViewHistory}
              onViewStream={selectedAgentStatus === 'executing' || selectedAgentStatus === 'busy' ? handleViewStream : undefined}
              onViewTaskQueue={handleViewTaskQueue}
              onAgentSettingsChange={handleAgentSettingsChange}
              variant="warm"
              onAssignTask={handleAssignTask}
            />
          </div>
        </div>
      )}

      {/* 任务输入框（按回车弹出） */}
      {showTaskInput && (
        <div className="absolute left-1/2 bottom-24 z-50 -translate-x-1/2 w-[90vw] max-w-xl rounded-xl border border-amber-200 bg-amber-50/95 shadow-lg">
          <div className="flex items-center gap-2 border-b border-amber-100 px-4 py-2">
            <span className="text-sm font-medium text-amber-800">
              {greetingAgentsRef.current.length > 0
                ? `分配任务给 ${agents.find(a => a.id === greetingAgentsRef.current[greetingAgentsRef.current.length - 1])?.name || '助手'}`
                : '发送消息'}
            </span>
            {/* 显示最后打招呼的助手 */}
            {greetingAgentsRef.current.length > 0 && (
              <AgentAvatarImage
                avatar={agents.find(a => a.id === greetingAgentsRef.current[greetingAgentsRef.current.length - 1])?.avatar}
                className="ml-2 size-6"
              />
            )}
            <button
              onClick={() => {
                setShowTaskInput(false)
                setInputValue('', chatRoomId)
              }}
              className="ml-auto rounded-md px-2 py-1 text-amber-600 hover:bg-amber-100"
            >
              ✕
            </button>
          </div>

          <ChatInputArea
            chatRoomId={chatRoomId || ''}
            chatRoomName={chatRoomName || '3D办公室'}
            handleKeyDown={handleKeyDown}
            handleSend={handleSendTask}
            mentionAgents={mentionAgents}
          />
        </div>
      )}

      {/* 群聊历史浮层（左下角，每段对话最多三行，H 键开关） */}
      {showChatHistory && chatRoomId && (
        <OfficeChatHistory
          chatRoomId={chatRoomId}
          selectedMessageId={selectedMessage?.id}
          onSelectMessage={handleSelectMessage}
          onClose={() => setShowChatHistory(false)}
        />
      )}

      {/* 群消息详情浮层（右侧，点击群聊历史中的消息展示） */}
      {selectedMessage && (
        <OfficeMessageDetail
          message={selectedMessage}
          fallbackUserAvatar={currentUser?.avatar}
          onClose={() => setSelectedMessage(null)}
        />
      )}

      {/* 操作说明浮层（集中介绍所有交互操作） */}
      {showHelp && (
        <div className="absolute left-4 bottom-8 z-50 w-72 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/95 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between border-b border-amber-100 px-4 py-2">
            <span className="text-sm font-medium text-amber-800">{t('office.helpPanel.title')}</span>
            <button
              onClick={() => setShowHelp(false)}
              className="rounded-md px-2 py-1 text-amber-700 hover:bg-amber-100"
            >
              ✕
            </button>
          </div>
          <div className="px-4 py-3">
            {/* 键盘快捷键 */}
            <div className="mb-1.5 text-xs font-medium text-amber-700/70">{t('office.helpPanel.keyboard')}</div>
            <div className="space-y-2">
              {[
                { keys: firstPerson ? ['W', 'S'] : ['W', 'A', 'S', 'D'], desc: firstPerson ? t('office.helpPanel.keysMoveForwardBack') : t('office.helpPanel.keysMoveBoss') },
                ...(firstPerson ? [{ keys: ['A', 'D'], desc: t('office.helpPanel.keysTurnLeftRight') }] : [{ keys: ['↑', '↓', '←', '→'], desc: t('office.helpPanel.keysMoveBossArrow') }]),
                { keys: ['Tab'], desc: t('office.helpPanel.keysNextAgent') },
                { keys: ['Shift', 'Tab'], desc: t('office.helpPanel.keysPrevAgent') },
                { keys: [t('chat.input.slashClear') === 'Clear Context' ? 'Space' : '空格'], desc: t('office.helpPanel.keysCameraReset') },
                { keys: ['V'], desc: t('office.helpPanel.keysToggleView') },
                { keys: ['H'], desc: t('office.helpPanel.keysToggleChatHistory') },
                { keys: ['J'], desc: t('office.helpPanel.keysEncourage') },
                { keys: [t('chat.input.slashClear') === 'Clear Context' ? 'Enter' : '回车'], desc: t('office.helpPanel.keysOpenTask') },
                { keys: ['?'], desc: t('office.helpPanel.keysToggleHelp') },
                { keys: ['Esc'], desc: t('office.helpPanel.keysCloseTask') },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="flex w-28 shrink-0 items-center gap-1">
                    {item.keys.map((k) => (
                      <kbd
                        key={k}
                        className="inline-flex min-w-[1.4rem] items-center justify-center rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 font-mono text-xs text-amber-800"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                  <span className="flex-1 text-sm text-amber-800/90">{item.desc}</span>
                </div>
              ))}
            </div>

            {/* 鼠标 / 界面 */}
            <div className="mb-1.5 mt-3.5 text-xs font-medium text-amber-700/70">{t('office.helpPanel.mouseUI')}</div>
            <div className="space-y-2">
              {[
                { label: t('office.helpPanel.clickAgent'), desc: t('office.helpPanel.clickAgentDesc') },
                { label: t('office.helpPanel.clickTitle'), desc: t('office.helpPanel.clickTitleDesc') },
                { label: t('office.helpPanel.viewButton'), desc: t('office.helpPanel.viewButtonDesc') },
                { label: t('office.helpPanel.qualityButton'), desc: t('office.helpPanel.qualityButtonDesc') },
                { label: t('office.helpPanel.timeButton'), desc: t('office.helpPanel.timeButtonDesc') },
                { label: t('office.helpPanel.dragMouse'), desc: firstPerson ? t('office.helpPanel.dragMouseDescTurn') : t('office.helpPanel.dragMouseDescRotate') },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-sm font-medium text-amber-900">{item.label}</span>
                  <span className="flex-1 text-sm text-amber-800/90">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 提示：回车输入提示 */}
      {!showTaskInput && (
        <div className="absolute left-1/2 bottom-8 z-50 -translate-x-1/2 flex items-center rounded-lg border border-amber-200/70 bg-amber-50/90 px-4 py-2 text-sm text-amber-800 shadow-sm backdrop-blur">
          {t('office.helpPanel.enterTipPrefix')} <kbd className="mx-1 rounded bg-amber-200 px-1.5 py-0.5 font-mono text-xs inline-flex items-center">{t('chat.input.slashClear') === 'Clear Context' ? 'Enter' : '回车'}</kbd>{' '}
          {greetingAgentsRef.current.length > 0 ? t('office.helpPanel.enterTipSuffix') : t('office.helpPanel.enterTipSend')}
        </div>
      )}
    </div>
  )
}

export default OfficePage