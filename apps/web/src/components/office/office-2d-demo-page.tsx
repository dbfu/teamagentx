import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

// ===== 2D 横版办公室 Demo（辐射避难所剖面风格）=====
// 纯 DOM/CSS 实现：多层楼、每间房有助手在干活走动，方向键控制老板逛楼层。
// 人物使用精灵图 public/office-sprite.png（4列×2行，每帧 362×543）：
//   row0: 站立 / 行走×3   row1: 行走 / 写字板(写) / 写字板(指) / 写字板(思考)

type Activity = '敲代码' | '思考中' | '回复中' | '干饭🍔' | '健身💪' | '摸鱼💤' | '开会'
type Pose = 'stand' | 'write' | 'point' | 'think'

interface AgentDef {
  id: string
  name: string
  activity: Activity
}

interface RoomDef {
  id: string
  label: string
  /** 房间宽度占比（flex-grow） */
  span: number
  /** 房间主色调（剖面灯光氛围） */
  tint: string
  agents: AgentDef[]
}

const ACTIVITIES: Activity[] = ['敲代码', '思考中', '回复中', '干饭🍔', '健身💪', '摸鱼💤', '开会']
const WORK_POSES: Pose[] = ['write', 'point', 'think']

// 楼层从上到下：自上而下排布房间
const FLOORS: RoomDef[][] = [
  [
    { id: 'r-boss', label: '老板办公室', span: 5, tint: '#1f3b57', agents: [] },
    { id: 'r-meet', label: '会议室', span: 4, tint: '#23414e', agents: [
      { id: 'a-gem', name: 'Gemini', activity: '开会' },
    ] },
  ],
  [
    { id: 'r-dev1', label: '研发室 A', span: 4, tint: '#244a3f', agents: [
      { id: 'a-claude', name: 'Claude', activity: '敲代码' },
    ] },
    { id: 'r-dev2', label: '研发室 B', span: 5, tint: '#2a4a55', agents: [
      { id: 'a-codex', name: 'Codex', activity: '思考中' },
      { id: 'a-qwen', name: 'Qwen', activity: '回复中' },
    ] },
  ],
  [
    { id: 'r-power', label: '发电室', span: 3, tint: '#3a3a24', agents: [
      { id: 'a-mistral', name: 'Mistral', activity: '敲代码' },
    ] },
    { id: 'r-canteen', label: '茶水间', span: 6, tint: '#2c3f57', agents: [
      { id: 'a-glm', name: 'GLM', activity: '干饭🍔' },
      { id: 'a-kimi', name: 'Kimi', activity: '干饭🍔' },
    ] },
  ],
  [
    { id: 'r-gym', label: '健身房', span: 5, tint: '#243a4a', agents: [
      { id: 'a-deepseek', name: 'DeepSeek', activity: '健身💪' },
    ] },
    { id: 'r-dorm', label: '宿舍', span: 4, tint: '#3a2c3f', agents: [
      { id: 'a-llama', name: 'Llama', activity: '摸鱼💤' },
    ] },
  ],
]

const FLOOR_H = 160 // 每层楼高度 px
const VAULT_W = 940 // 避难所剖面宽度 px
const AGENT_H = 70 // 助手精灵显示高度 px
const BOSS_H = 78 // 老板精灵显示高度 px
const SPRITE_RATIO = 362 / 543 // 单帧宽高比

// ===== 精灵小人 =====
function Sprite({ h, walk = false, pose = 'stand' }: { h: number; walk?: boolean; pose?: Pose }) {
  const cls = walk ? 'oc-sprite oc-walk' : `oc-sprite oc-pose-${pose}`
  return <div className={cls} style={{ width: h * SPRITE_RATIO, height: h }} />
}

// ===== 在房间内来回踱步 / 站立工作的助手 =====
function RoomAgent({ agent, range, idx }: { agent: AgentDef; range: number; idx: number }) {
  const [activity, setActivity] = useState<Activity>(agent.activity)
  const [walking, setWalking] = useState(idx % 2 === 0)
  const [pose, setPose] = useState<Pose>('write')
  const dur = useMemo(() => 5 + Math.random() * 4, [])
  const delay = useMemo(() => `${-Math.random() * dur}s`, [dur])
  const left = useMemo(() => 18 + idx * 8, [idx])

  // 周期性切换 走动 / 站立工作 状态与气泡文案
  useEffect(() => {
    const t = setInterval(() => {
      setWalking((w) => !w)
      setPose(WORK_POSES[Math.floor(Math.random() * WORK_POSES.length)])
      setActivity(ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)])
    }, 3500 + Math.random() * 3500)
    return () => clearInterval(t)
  }, [])

  return (
    <div
      className={`oc-actor ${walking ? 'oc-pace' : ''}`}
      style={{
        left,
        ['--range' as string]: `${range}px`,
        ['--d' as string]: `${dur}s`,
        animationDelay: delay,
      }}
    >
      <div className="oc-bubble">{activity}</div>
      {walking ? (
        <div className="oc-face" style={{ animationDelay: delay }}>
          <Sprite h={AGENT_H} walk />
        </div>
      ) : (
        <Sprite h={AGENT_H} pose={pose} />
      )}
      <div className="oc-name">{agent.name}</div>
    </div>
  )
}

export function Office2dDemoPage() {
  const navigate = useNavigate()
  const [floor, setFloor] = useState(2) // 老板初始在茶水间那层
  const bossXRef = useRef(VAULT_W / 2)
  const bossElRef = useRef<HTMLDivElement>(null)
  const keys = useRef({ left: false, right: false })
  const [moving, setMoving] = useState(false)

  // 键盘控制：左右移动 + 上下换楼层
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === 'a' || k === 'arrowleft') { keys.current.left = true; e.preventDefault() }
      if (k === 'd' || k === 'arrowright') { keys.current.right = true; e.preventDefault() }
      if (k === 'w' || k === 'arrowup') { setFloor((f) => Math.max(0, f - 1)); e.preventDefault() }
      if (k === 's' || k === 'arrowdown') { setFloor((f) => Math.min(FLOORS.length - 1, f + 1)); e.preventDefault() }
    }
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === 'a' || k === 'arrowleft') keys.current.left = false
      if (k === 'd' || k === 'arrowright') keys.current.right = false
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  // rAF 移动老板
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastMoving = false
    let facing = 1
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const dir = (keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0)
      if (dir !== 0) {
        bossXRef.current = Math.max(8, Math.min(VAULT_W - 50, bossXRef.current + dir * 220 * dt))
        facing = dir
      }
      const el = bossElRef.current
      if (el) {
        el.style.transform = `translateX(${bossXRef.current}px) scaleX(${facing})`
      }
      const isMoving = dir !== 0
      if (isMoving !== lastMoving) {
        lastMoving = isMoving
        setMoving(isMoving)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="oc-root">
      <style>{CSS}</style>

      {/* 顶部 HUD */}
      <div className="oc-hud">
        <button className="oc-back" onClick={() => navigate('/office-demo')}>
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <div className="oc-vault">VAULT-X</div>
        <div className="oc-stat">🙂 满意度 88%</div>
        <div className="oc-stat">🤖 {FLOORS.flat().reduce((n, r) => n + r.agents.length, 0)} 位助手</div>
        <div className="oc-hint">A/D ← → 走动 · W/S ↑ ↓ 上下楼 👑</div>
      </div>

      {/* 避难所剖面 */}
      <div className="oc-scroll">
        <div className="oc-vault-body" style={{ width: VAULT_W }}>
          {FLOORS.map((rooms, fi) => (
            <div
              key={fi}
              className={`oc-floor ${fi === floor ? 'oc-floor-active' : ''}`}
              style={{ height: FLOOR_H }}
            >
              {rooms.map((room) => (
                <div
                  key={room.id}
                  className="oc-room"
                  style={{ flexGrow: room.span, background: roomGradient(room.tint), ['--tint' as string]: room.tint }}
                >
                  <div className="oc-back" />
                  <div className="oc-floor3d" />
                  <div className="oc-room-label">{room.label}</div>
                  {room.agents.map((agent, ai) => (
                    <RoomAgent key={agent.id} agent={agent} range={room.span * 20} idx={ai} />
                  ))}
                </div>
              ))}
            </div>
          ))}

          {/* 老板（绝对定位在当前楼层地面上） */}
          <div className="oc-boss" style={{ top: floor * FLOOR_H + FLOOR_H - BOSS_H - 16 }}>
            <div ref={bossElRef} className="oc-boss-mover">
              <div className="oc-crown">👑</div>
              <Sprite h={BOSS_H} walk={moving} pose="stand" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function roomGradient(tint: string) {
  return `linear-gradient(180deg, ${tint} 0%, ${shade(tint, -18)} 100%)`
}

// 简单颜色加深
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt))
  const b = Math.max(0, Math.min(255, (n & 255) + amt))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

const CSS = `
.oc-root { position: relative; height: 100%; width: 100%; overflow: hidden;
  background: radial-gradient(circle at 50% 0%, #4a3a2a 0%, #2a2018 55%, #1a140e 100%); }

.oc-hud { position: absolute; top: 0; left: 0; right: 0; z-index: 20; display: flex;
  align-items: center; gap: 10px; padding: 12px 16px; }
.oc-back { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #3a5;
  background: rgba(20,40,20,.7); color: #8f8; padding: 6px 10px; border-radius: 8px;
  font-size: 13px; cursor: pointer; }
.oc-back:hover { background: rgba(20,60,20,.8); }
.oc-vault { font-weight: 800; letter-spacing: 2px; color: #7CFC00; font-size: 18px;
  text-shadow: 0 0 8px rgba(124,252,0,.5); }
.oc-stat { color: #cfe8b0; font-size: 13px; background: rgba(0,0,0,.3); padding: 4px 10px; border-radius: 999px; }
.oc-hint { margin-left: auto; color: #ffe9a8; font-size: 12px; background: rgba(60,50,10,.6);
  padding: 6px 12px; border-radius: 8px; }

.oc-scroll { position: absolute; inset: 0; padding-top: 64px; overflow: auto; display: flex; justify-content: center; }
.oc-vault-body { position: relative; padding-bottom: 40px; }

.oc-floor { display: flex; gap: 6px; padding: 4px 0; transition: filter .25s; filter: brightness(.62) saturate(.8); }
.oc-floor-active { filter: brightness(1) saturate(1); }

.oc-room { position: relative; border-radius: 6px; overflow: hidden; min-width: 120px;
  perspective: 460px; perspective-origin: 50% 38%;
  box-shadow: inset 0 0 36px rgba(0,0,0,.55), 0 2px 0 rgba(0,0,0,.55);
  border-top: 2px solid rgba(255,255,255,.08); }
/* 天花灯带 */
.oc-room::before { content: ''; position: absolute; top: 9px; left: 14px; right: 14px; height: 4px;
  border-radius: 4px; background: rgba(255,255,255,.45);
  box-shadow: 0 0 22px 6px rgba(255,245,210,.30); z-index: 1; }
/* 顶部阴影（天花板压暗） */
.oc-room::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 22px;
  background: linear-gradient(180deg, rgba(0,0,0,.55), transparent); pointer-events: none; z-index: 1; }
.oc-room-label { position: absolute; top: 5px; right: 10px; font-size: 11px; color: rgba(255,255,255,.5);
  letter-spacing: 1px; z-index: 3; }

/* 后墙设备：竖向管道 + 发光屏幕 */
.oc-back { position: absolute; top: 18px; left: 8px; right: 8px; bottom: 56px; border-radius: 4px;
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 2px, transparent 2px 30px),
    radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,.08), transparent 60%);
  box-shadow: inset 0 0 24px rgba(0,0,0,.35); }
.oc-back::after { content: ''; position: absolute; right: 10%; top: 26%; width: 30px; height: 20px;
  border-radius: 3px; background: rgba(70,200,130,.22); border: 1px solid rgba(120,255,170,.45);
  box-shadow: 0 0 10px rgba(80,220,140,.5), inset 0 0 8px rgba(80,220,140,.4); }

/* 向后倾斜的地板（透视梯形）：近大远小 */
.oc-floor3d { position: absolute; left: -14%; right: -14%; bottom: 0; height: 72px;
  transform-origin: bottom center; transform: rotateX(64deg);
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,.09) 0 20px, rgba(0,0,0,.16) 20px 40px),
    linear-gradient(180deg, color-mix(in srgb, var(--tint, #2a3a4a) 70%, #000) 0%, #14181c 100%);
  box-shadow: inset 0 26px 40px rgba(0,0,0,.5); }

/* 精灵图人物：4列×2行 → background-size 400% 200% */
.oc-sprite { background-image: url(/office-sprite.png); background-repeat: no-repeat;
  background-size: 400% 200%; image-rendering: auto; }
.oc-pose-stand { background-position: 0% 0%; }
.oc-pose-write { background-position: 33.333% 100%; }
.oc-pose-point { background-position: 66.667% 100%; }
.oc-pose-think { background-position: 100% 100%; }
.oc-walk { animation: oc-walk .55s linear infinite; }
@keyframes oc-walk {
  0%,24.99%  { background-position: 33.333% 0%; }
  25%,49.99% { background-position: 66.667% 0%; }
  50%,74.99% { background-position: 100% 0%; }
  75%,100%   { background-position: 0% 100%; }
}

/* 助手定位与气泡 */
.oc-actor { position: absolute; bottom: 14px; display: flex; flex-direction: column; align-items: center; }
.oc-pace { animation: oc-pace var(--d,5s) ease-in-out infinite alternate; }
@keyframes oc-pace { from { transform: translateX(0); } to { transform: translateX(var(--range,40px)); } }
/* 行走时朝向翻转：与踱步方向同步（周期为踱步的两倍） */
.oc-face { animation: oc-face calc(var(--d,5s)*2) steps(1,end) infinite; }
@keyframes oc-face { 0%,49.99% { transform: scaleX(1); } 50%,100% { transform: scaleX(-1); } }

.oc-bubble { white-space: nowrap; font-size: 10px; color: #2a2a2a; background: #fff; padding: 2px 6px;
  border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.3); margin-bottom: 2px; position: relative; }
.oc-bubble::after { content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  border: 4px solid transparent; border-top-color: #fff; }
.oc-name { margin-top: 1px; font-size: 10px; color: #eafbe0; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
.oc-crown { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: -4px;
  font-size: 16px; z-index: 2; }

/* 老板 */
.oc-boss { position: absolute; left: 0; z-index: 10; transition: top .25s ease; pointer-events: none; }
.oc-boss-mover { position: relative; will-change: transform; }
`

export default Office2dDemoPage
