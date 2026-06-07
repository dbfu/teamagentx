import { useMemo } from 'react'
import { Sky, Stars } from '@react-three/drei'

/** 把小时（0-24，带小数）格式化为 HH:MM */
export function formatClock(hour: number) {
  const h = Math.floor(hour) % 24
  const m = Math.floor((hour - Math.floor(hour)) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 当前时段中文标签 */
export function timePhaseLabel(hour: number) {
  if (hour < 5) return '深夜'
  if (hour < 7) return '清晨'
  if (hour < 11) return '上午'
  if (hour < 13) return '正午'
  if (hour < 17) return '下午'
  if (hour < 19) return '黄昏'
  if (hour < 22) return '夜晚'
  return '深夜'
}

/** 夜色程度：0=白天，1=深夜（黄昏/清晨平滑过渡） */
function nightFactor(hour: number) {
  let n: number
  if (hour < 5 || hour >= 20) n = 1
  else if (hour < 7) n = (7 - hour) / 2
  else if (hour <= 18) n = 0
  else n = (hour - 18) / 2
  return Math.max(0, Math.min(1, n))
}

// 地面矩形（与布局一致）
interface FloorRect { cx: number; cz: number; w: number; d: number }
// 各房间中心上方的吊灯位置（未传入 floors 时的默认布局）
// 新布局：老板办公室 [0,9]，工位区 [0,0] 附近，活动房间螺旋扩展
const DEFAULT_LAMPS: [number, number, number][] = [
  [0, 4.6, 0],     // 工位区（网格 [0,0]）
  [0, 4.6, 9],     // 老板办公室（网格 [0,1]）
  [-9, 4.6, 9],    // 茶水间（可能在 [-1,1]）
  [9, 4.6, 9],     // 健身房（可能在 [1,1]）
  [9, 4.6, 18],    // 休息室（可能在 [0,2]）
  [-9, 4.6, 0],    // 娱乐室（可能在 [-1,0]）
]

/** 夜间室内灯：每间房中心一盏吊灯 + 暖光点光源，强度随夜色 0→1 渐入 */
function CeilingLamps({ intensity, lamps }: { intensity: number; lamps: [number, number, number][] }) {
  return (
    <group>
      {lamps.map((p, i) => (
        <group key={i} position={p}>
          {/* 吊杆 */}
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 0.7, 6]} />
            <meshStandardMaterial color="#333" />
          </mesh>
          {/* 灯罩 */}
          <mesh>
            <coneGeometry args={[0.32, 0.28, 16, 1, true]} />
            <meshStandardMaterial color="#2b2b2b" side={2} />
          </mesh>
          {/* 灯泡（发光） */}
          <mesh position={[0, -0.08, 0]}>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshBasicMaterial color="#ffe6b0" />
          </mesh>
          {/* 暖光点光源 */}
          <pointLight
            position={[0, -0.15, 0]}
            color="#ffd9a0"
            intensity={intensity * 26}
            distance={18}
            decay={1.6}
          />
        </group>
      ))}
    </group>
  )
}

/**
 * 天空与光照：白天 drei <Sky> 蓝天，夜晚转为深色背景 + 星空 + 室内点灯，
 * 光照强度随昼夜变化。
 */
export function DayNight({
  hour = 12,
  shadowMapSize = 2048,
  shadows = true,
  floors,
}: {
  hour?: number
  shadowMapSize?: number
  shadows?: boolean
  floors?: FloorRect[]
}) {
  const night = nightFactor(hour)
  const day = 1 - night

  // 吊灯：每间房中心一盏；阴影范围：覆盖所有房间的外接半径
  const { lamps, reach } = useMemo(() => {
    if (!floors || floors.length === 0) {
      return { lamps: DEFAULT_LAMPS, reach: 22 }
    }
    const lampList = floors.map((f) => [f.cx, 4.6, f.cz] as [number, number, number])
    let r = 22
    for (const f of floors) {
      r = Math.max(r, Math.abs(f.cx) + f.w / 2, Math.abs(f.cz) + f.d / 2)
    }
    return { lamps: lampList, reach: r + 6 }
  }, [floors])

  // 让太阳与阴影相机随房间范围放大（方向保持原 [40,50,30] 不变）
  const sunDist = reach * 2.2
  const sunPos: [number, number, number] = [sunDist * 0.6, sunDist * 0.75, sunDist * 0.45]

  return (
    <>
      {night < 0.5 ? (
        <Sky sunPosition={[100, 20, 100]} />
      ) : (
        <color attach="background" args={['#070b1a']} />
      )}
      {/* 夜晚星空 */}
      {night > 0.35 && (
        <Stars radius={90} depth={40} count={2500} factor={14} saturation={0} fade speed={1} />
      )}
      {/* 夜晚室内点灯（每间房一盏，随房间复制） */}
      {night > 0.1 && <CeilingLamps intensity={night} lamps={lamps} />}
      {/* 雾：白天天蓝、夜晚深蓝，让地面边缘融入天空；随房间范围外推 */}
      <fog attach="fog" args={[night > 0.5 ? '#0a1124' : '#cfe0f2', reach + 6, reach * 1.8 + 24]} />
      <ambientLight intensity={0.12 + day * 0.4} color="#fff8ee" />
      <directionalLight
        position={sunPos}
        intensity={0.15 + day * 0.95}
        color="#fff4e3"
        castShadow={shadows}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
        shadow-camera-far={sunDist * 2.4}
      />
    </>
  )
}
