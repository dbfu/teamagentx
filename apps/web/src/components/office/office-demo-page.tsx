import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, ContactShadows } from '@react-three/drei'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import * as THREE from 'three'
import { OfficeCharacter, type CharacterAnim } from './office-character'
import { RoomWithFloorTiles, Desk, Sofa, BreakTable, Plant, YogaMat, DumbbellRack, Treadmill, Bed, BossDesk, BossChair, Bookshelf, TV, GameConsole, LoungeSofa } from './office-furniture'
import { AGENTS, GYM_SPOTS, useOfficeAgents } from './use-office-agents'
import { OBSTACLES } from './office-obstacles'
import { buildWalkableGrid, isWalkable, type WalkGrid } from './office-pathfinding'

// Demo 用静态障碍物，网格只建一次
const WALK_GRID: WalkGrid = buildWalkableGrid(OBSTACLES)

const ANIM_LABEL: Record<CharacterAnim, string> = {
  idle: '空闲待命',
  typing: '敲代码',
  thinking: '思考中',
  talking: '回复中',
  walking: '走动',
  sitting: '沙发休息',
  eating: '干饭中',
  workout: '健身中',
  gaming: '打游戏',
  sleeping: '睡觉中',
}

const ANIM_BUBBLE: Partial<Record<CharacterAnim, string>> = {
  typing: '执行 Bash…',
  thinking: '思考中…',
  talking: '正在回复…',
  sitting: '休息一下~',
  eating: '干饭中🍔',
  workout: '健身💪',
  sleeping: '睡觉💤',
}

const MAT_COLORS = ['#6bb36b', '#5b9bd5', '#e08a5b', '#a87fce']

// 老板人物组件（可控制移动）
function BossCharacter({ walkGrid }: { walkGrid: WalkGrid }) {
  const rootRef = useRef<THREE.Group>(null)
  const pos = useRef({ x: 0, z: 4, rotY: Math.PI }) // 初始在老板办公室
  const keys = useRef({ w: false, a: false, s: false, d: false })

  // 键盘控制
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === 'w' || key === 'arrowup') keys.current.w = true
      if (key === 'a' || key === 'arrowleft') keys.current.a = true
      if (key === 's' || key === 'arrowdown') keys.current.s = true
      if (key === 'd' || key === 'arrowright') keys.current.d = true
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === 'w' || key === 'arrowup') keys.current.w = false
      if (key === 'a' || key === 'arrowleft') keys.current.a = false
      if (key === 's' || key === 'arrowdown') keys.current.s = false
      if (key === 'd' || key === 'arrowright') keys.current.d = false
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // 每帧更新位置
  useFrame((_, delta) => {
    if (!rootRef.current) return
    const dt = Math.min(delta, 0.05)
    const k = keys.current
    let dx = 0, dz = 0
    if (k.w) dz = -1
    if (k.s) dz = 1
    if (k.a) dx = -1
    if (k.d) dx = 1

    if (dx !== 0 || dz !== 0) {
      const mag = Math.hypot(dx, dz)
      const ndx = dx / mag, ndz = dz / mag
      const targetRot = Math.atan2(ndx, ndz)
      let diff = targetRot - pos.current.rotY
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      pos.current.rotY += diff * 8 * dt

      const speed = 2.5
      const nx = pos.current.x + ndx * speed * dt
      const nz = pos.current.z + ndz * speed * dt
      // 格子碰撞：滑动墙壁
      if (isWalkable(nx, nz, walkGrid)) {
        pos.current.x = nx
        pos.current.z = nz
      } else if (isWalkable(nx, pos.current.z, walkGrid)) {
        pos.current.x = nx
      } else if (isWalkable(pos.current.x, nz, walkGrid)) {
        pos.current.z = nz
      }
    }

    // 更新 Three.js group 位置
    rootRef.current.position.set(pos.current.x, 0, pos.current.z)
    rootRef.current.rotation.y = pos.current.rotY
  })

  return (
    <group ref={rootRef}>
      {/* 老板身体 - 用更大更高的模型 */}
      {/* 身体 */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <boxGeometry args={[0.6, 0.7, 0.38]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      {/* 腿 */}
      <mesh position={[-0.15, 0.35, 0]} castShadow>
        <boxGeometry args={[0.22, 0.7, 0.22]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      <mesh position={[0.15, 0.35, 0]} castShadow>
        <boxGeometry args={[0.22, 0.7, 0.22]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      {/* 头 */}
      <mesh position={[0, 1.55, 0]} castShadow>
        <boxGeometry args={[0.38, 0.38, 0.36]} />
        <meshStandardMaterial color="#f1c9a5" />
      </mesh>
      {/* 头发 */}
      <mesh position={[0, 1.78, 0]} castShadow>
        <boxGeometry args={[0.42, 0.12, 0.4]} />
        <meshStandardMaterial color="#2d2d2d" />
      </mesh>
      {/* 眼睛 */}
      <mesh position={[-0.09, 1.55, 0.21]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh position={[0.09, 1.55, 0.21]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      {/* 名字标签 */}
      <mesh position={[0, 2.2, 0]}>
        <sphereGeometry args={[0.08, 16, 12]} />
        <meshStandardMaterial color="#ffd700" emissive="#ffd700" emissiveIntensity={0.5} />
      </mesh>
    </group>
  )
}

export function OfficeDemoPage() {
  const navigate = useNavigate()
  const { states, outputs, stations, setAllBusy, setAllBreak, setAllWorkout } = useOfficeAgents()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [streamed, setStreamed] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const selected = AGENTS.find((a) => a.id === selectedId) || null
  const selectedAnim = selected ? states[selected.id] : 'idle'
  const selectedOutput = selected ? outputs[selected.id] : ''

  // 选中助手的输出做流式打字效果
  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    const full = selectedOutput
    setStreamed('')
    if (!full) return
    let i = 0
    timer.current = setInterval(() => {
      i += 2
      setStreamed(full.slice(0, i))
      if (i >= full.length && timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    }, 35)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [selectedId, selectedOutput])

  return (
    <div
      className="relative h-full w-full"
      style={{ background: 'linear-gradient(180deg, #c79a6b 0%, #e0b98c 40%, #f3e3cf 100%)' }}
    >
      {/* 顶部 */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 text-sm text-gray-600 backdrop-blur hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <div className="rounded-lg bg-white/80 px-3 py-1.5 text-sm font-medium text-gray-700 backdrop-blur">
          3D 办公室 · 技术 Demo · {AGENTS.length} 位助手 + 老板
        </div>
        <button
          onClick={() => navigate('/office-2d-demo')}
          className="rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 text-sm text-gray-600 backdrop-blur hover:bg-gray-50"
        >
          🏢 2D 横版 Demo
        </button>
        {/* 控制提示 */}
        <div className="rounded-lg bg-yellow-100/90 px-3 py-1.5 text-xs font-medium text-yellow-800 backdrop-blur">
          WASD/方向键 控制老板移动 👑
        </div>
      </div>

      {/* 全局控制 */}
      <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 gap-2 rounded-xl border border-gray-200 bg-white/90 p-2 shadow-lg backdrop-blur">
        <span className="self-center px-1 text-xs text-gray-400">助手们正在自主活动</span>
        <button onClick={setAllBusy} className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600">
          全员开工
        </button>
        <button onClick={setAllBreak} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          全员午休
        </button>
        <button onClick={setAllWorkout} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          全员健身
        </button>
      </div>

      <Canvas shadows camera={{ position: [0, 12, 12], fov: 48 }} gl={{ alpha: true }}>
        {/* 透明背景 + 暖色雾，让墙体远处自然融入渐变背景 */}
        <fog attach="fog" args={['#e3c39c', 20, 45]} />
        <ambientLight intensity={0.75} color="#fff1de" />
        <directionalLight
          position={[8, 12, 8]}
          intensity={1.15}
          color="#ffe9cf"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <RoomWithFloorTiles />
        {/* 老板办公室 - 茶水间和健身房中间 */}
        <BossDesk position={[0, 0, 5.5]} rotationY={0} />
        <BossChair position={[0, 0, 4]} rotationY={Math.PI} />
        <Sofa position={[-3, 0, 6]} width={3} rotationY={Math.PI / 2} />
        <Bookshelf position={[3, 0, 8]} rotationY={Math.PI / 2} />
        <Plant position={[-3, 0, 2.5]} />
        <Plant position={[3, 0, 2.5]} />

        {/* 茶水间：两张餐桌 */}
        <BreakTable position={[-7, 0, 3.5]} />
        <BreakTable position={[-7, 0, 6.5]} />

        {/* 健身室：器材 + 瑜伽垫 */}
        <DumbbellRack position={[4.5, 0, 6]} />
        <Treadmill position={[8, 0, 6]} rotationY={0} />
        {GYM_SPOTS.map((s, i) => (
          <YogaMat key={i} position={[s.pos[0], s.pos[1], s.pos[2] - 0.4]} color={MAT_COLORS[i % MAT_COLORS.length]} />
        ))}

        {/* 休息区（健身室右边）：沙发 + 三张床 */}
        <Sofa position={[13, 0, 3.5]} width={4} rotationY={Math.PI} />
        <Bed position={[11, 0, 7]} rotationY={Math.PI / 2} />
        <Bed position={[13, 0, 7]} rotationY={Math.PI / 2} />
        <Bed position={[15, 0, 7]} rotationY={Math.PI / 2} />

        {/* 绿植放在角落 */}
        <Plant position={[-9, 0, -7]} />
        <Plant position={[9, 0, -7]} />

        {/* 娱乐室（新位置） */}
        <TV position={[12, 0, -5]} rotationY={0} />
        <GameConsole position={[13, 0, -3.5]} rotationY={Math.PI / 4} />
        <LoungeSofa position={[15, 0, -2.5]} rotationY={Math.PI / 2} />

        {AGENTS.map((agent) => {
          const anim = states[agent.id]
          const station = stations[agent.id]
          return (
            <group key={agent.id}>
              <Desk position={agent.deskFurniture} screenText={outputs[agent.id]} />
              <OfficeCharacter
                position={station.pos}
                rotationY={station.rot}
                anim={anim}
                color={agent.color}
                name={agent.name}
                bubble={ANIM_BUBBLE[anim]}
                selected={selectedId === agent.id}
                onClick={() => setSelectedId(agent.id)}
                walkGrid={WALK_GRID}
              />
            </group>
          )
        })}

        {/* 老板人物（键盘 WASD 控制移动） */}
        <BossCharacter walkGrid={WALK_GRID} />

        <ContactShadows position={[0, 0.02, 0]} opacity={0.3} scale={22} blur={2.2} far={8} frames={1} />
        <OrbitControls
          target={[0, 1, 1]}
          // 鼠标按钮：左键平移，右键旋转
          mouseButtons={{
            LEFT: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
          }}
          enablePan={true}
          panSpeed={0.5}
          minDistance={2}
          maxDistance={35}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI / 2.3}
        />
      </Canvas>

      {/* 未选中提示 */}
      {!selected && (
        <div className="absolute right-4 top-16 z-10 rounded-lg bg-white/80 px-3 py-2 text-xs text-gray-500 shadow backdrop-blur">
          👆 点击任意助手，查看 ta 的任务面板
        </div>
      )}

      {/* 点击助手弹出的任务面板 */}
      {selected && (
        <div className="absolute right-4 top-16 bottom-24 z-10 flex w-80 flex-col rounded-xl border border-gray-200 bg-white/95 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs text-white"
              style={{ background: selected.color }}
            >
              {selected.avatar}
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">助手 · {selected.name}</span>
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: selectedOutput ? '#22c55e' : '#9ca3af' }} />
                {ANIM_LABEL[selectedAnim]}
              </span>
            </div>
            <button onClick={() => setSelectedId(null)} className="ml-auto rounded-md px-2 py-1 text-gray-400 hover:bg-gray-100">
              ✕
            </button>
          </div>

          <div className="border-b border-gray-100 px-4 py-3">
            <div className="mb-1.5 text-xs font-medium text-gray-500">任务输入</div>
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
              <span className="font-medium" style={{ color: selected.color }}>
                {selected.task.split(' ')[0]}{' '}
              </span>
              {selected.task.split(' ').slice(1).join(' ')}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
            <div className="mb-1.5 text-xs font-medium text-gray-500">执行输出</div>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-gray-50 px-3 py-2">
              {streamed ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-700">
                  {streamed}
                  <span className="animate-pulse">▋</span>
                </pre>
              ) : (
                <div className="flex h-full items-center justify-center text-center text-xs text-gray-400">
                  ta 正在 {ANIM_LABEL[selectedAnim]}，暂无产出
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-gray-100 px-4 py-2 text-[11px] leading-relaxed text-gray-400">
            真实场景：每个助手 = 一个 <code className="text-gray-500">ChatRoomAgent</code>，
            状态由 <code className="text-gray-500">agent:*</code> 事件驱动
          </div>
        </div>
      )}
    </div>
  )
}

export default OfficeDemoPage
