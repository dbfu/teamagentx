export interface Obstacle {
  cx: number
  cz: number
  // 矩形障碍物属性（当 r 不存在时必须）
  width?: number   // 物品宽度（X方向）
  depth?: number   // 物品深度（Z方向）
  rotationY?: number // 旋转角度（弧度）
  // 圆形障碍物（用于工位等圆形区域）
  r?: number
}

// 家具类型对应的障碍物尺寸映射
const FURNITURE_OBSTACLE_MAP: Record<string, { width?: number; depth?: number; radius?: number }> = {
  table: { radius: 1.2 },        // 圆桌用圆形障碍物
  sofa: { width: 4.0, depth: 0.8 },
  // 床可视尺寸 2.2×1.2；isInRectObstacle 会再加 2*expand(0.5) 膨胀，
  // 这里预先减去 0.5，使有效碰撞≈可视尺寸，避免床两端出现空气墙
  bed: { width: 1.7, depth: 0.7 },
  mat: { width: 0.7, depth: 1.4 }, // 瑜伽垫不作为障碍物（太小）
  cushion: { width: 0.7, depth: 0.7 }, // 坐垫不作为障碍物
  tv: { width: 2.0, depth: 0.45 },
  console: { width: 1.2, depth: 0.6 },
  arcade: { width: 0.8, depth: 0.7 },
  dumbbell: { width: 0.9, depth: 0.45 },
  treadmill: { width: 0.7, depth: 1.5 },
  plant: { radius: 0.35 },
}

// 非工位的静态障碍（家具）- 老板办公室固定家具
// 老板办公室位于网格 [0,1]，世界坐标 cz = 9（ROOM_SIZE + GAP = 9）
const STATIC_OBSTACLES: Obstacle[] = [
  // 老板办公室家具（网格 [0,1]，cz = 9）
  { cx: 0, cz: 8.5, width: 2.4, depth: 1.2, rotationY: 0 },   // 老板办公桌
  { cx: 0, cz: 10, width: 0.6, depth: 0.6, rotationY: 0 },    // 老板椅（桌后，面向房间）
  { cx: -3, cz: 9, width: 3.0, depth: 0.8, rotationY: Math.PI / 2 }, // 沙发（侧放）
  { cx: 3, cz: 10, width: 1.5, depth: 0.4, rotationY: Math.PI / 2 },  // 书柜（侧放）
]

/** 根据动态工位坐标生成完整障碍物列表 */
export function buildObstacles(deskPositions: { cx: number; cz: number }[]): Obstacle[] {
  return [
    // 工位用圆形近似（桌+椅区域）
    ...deskPositions.map(({ cx, cz }) => ({ cx, cz, r: 1.0 })),
    ...STATIC_OBSTACLES,
  ]
}

// 墙体障碍参数
const WALL_SEGMENT_LENGTH = 2   // 单块墙模型长度（scale=2）
const WALL_THICKNESS = 0.4      // 墙体厚度（碰撞用）
// 可通行的开口类型：门和窗作为进出口放行，其余墙体阻挡
const PASSABLE_WALL_TYPES = new Set(['door', 'window'])

type WallLike = { pos: [number, number, number]; rotationY: number; type?: string }

/** 把墙段转成矩形障碍（门/窗开口放行，助手只能走门） */
export function buildWallObstacles(walls: WallLike[]): Obstacle[] {
  const obstacles: Obstacle[] = []
  for (const w of walls) {
    if (w.type && PASSABLE_WALL_TYPES.has(w.type)) continue // 开口放行
    const [cx, , cz] = w.pos
    // 墙模型长度沿局部 X，厚度沿局部 Z，按 rotationY 旋转
    obstacles.push({ cx, cz, width: WALL_SEGMENT_LENGTH, depth: WALL_THICKNESS, rotationY: w.rotationY })
  }
  return obstacles
}

/** 根据工位坐标和家具列表生成完整障碍物列表（支持动态家具、墙体） */
export function buildFullObstacles(
  deskPositions: { cx: number; cz: number }[],
  furniture: { kind: string; pos: [number, number, number]; rotationY: number }[],
  walls: WallLike[] = [],
): Obstacle[] {
  const obstacles: Obstacle[] = [
    // 工位用圆形近似
    ...deskPositions.map(({ cx, cz }) => ({ cx, cz, r: 1.0 })),
    // 老板办公室固定家具
    ...STATIC_OBSTACLES,
  ]

  // 添加动态家具障碍（排除小物品如瑜伽垫、坐垫）
  const SMALL_ITEMS = ['mat', 'cushion']
  for (const item of furniture) {
    if (SMALL_ITEMS.includes(item.kind)) continue
    const sizeInfo = FURNITURE_OBSTACLE_MAP[item.kind]
    if (!sizeInfo) continue
    const [cx, , cz] = item.pos
    if (sizeInfo.radius) {
      obstacles.push({ cx, cz, r: sizeInfo.radius })
    } else if (sizeInfo.width && sizeInfo.depth) {
      obstacles.push({ cx, cz, width: sizeInfo.width, depth: sizeInfo.depth, rotationY: item.rotationY })
    }
  }

  // 添加墙体障碍（门/窗开口放行）
  obstacles.push(...buildWallObstacles(walls))

  return obstacles
}

// 向后兼容：默认 4 工位（单排 z=-2.5）
export const OBSTACLES: Obstacle[] = buildObstacles(
  [-5, -1.7, 1.7, 5].map(cx => ({ cx, cz: -2.5 })),
)

/**
 * 判断点是否在矩形障碍物内部（考虑旋转）
 * @param expand 膨胀半径，默认 0.25（比之前的 0.4 更小，让角色能走到座位）
 */
export function isInRectObstacle(px: number, pz: number, obs: Obstacle, expand = 0.25): boolean {
  // 如果是圆形障碍物（有 r 属性）
  if (obs.r !== undefined) {
    return Math.hypot(px - obs.cx, pz - obs.cz) < obs.r + expand
  }

  // 矩形障碍物：需要 width 和 depth 属性
  if (obs.width === undefined || obs.depth === undefined) return false

  const rotationY = obs.rotationY ?? 0

  // 将点转换到障碍物的局部坐标系
  const dx = px - obs.cx
  const dz = pz - obs.cz

  // 逆旋转到局部坐标
  const cos = Math.cos(-rotationY)
  const sin = Math.sin(-rotationY)
  const localX = dx * cos - dz * sin
  const localZ = dx * sin + dz * cos

  // 判断是否在矩形内（加上角色碰撞半径膨胀）
  const halfW = obs.width / 2 + expand
  const halfD = obs.depth / 2 + expand

  return Math.abs(localX) < halfW && Math.abs(localZ) < halfD
}

/**
 * 简化版避障：只绕开家具，无墙壁限制
 */
export function steerToward(
  px: number,
  pz: number,
  goalX: number,
  goalZ: number,
  obstacles: Obstacle[],
): [number, number] {
  const dx = goalX - px
  const dz = goalZ - pz
  const dist = Math.hypot(dx, dz)
  if (dist < 0.001) return [0, 0]

  const gx = dx / dist
  const gz = dz / dist

  let rx = 0
  let rz = 0

  for (const obs of obstacles) {
    // 目标在障碍物附近时跳过，允许角色到达座位
    const goalDist = obs.r !== undefined
      ? Math.hypot(obs.cx - goalX, obs.cz - goalZ)
      : Math.hypot(obs.cx - goalX, obs.cz - goalZ) // 矩形也用中心距离估算
    if (goalDist < 1.5) continue

    // 计算障碍物的影响
    if (obs.r !== undefined) {
      // 圆形障碍物
      const ox = px - obs.cx
      const oz = pz - obs.cz
      const d = Math.hypot(ox, oz)

      const influence = obs.r + 0.5
      if (d < influence && d > 0.01) {
        const force = ((influence - d) / influence) * 2.0
        rx += (ox / d) * force
        rz += (oz / d) * force
      }
    } else if (obs.width !== undefined && obs.depth !== undefined) {
      // 矩形障碍物
      if (isInRectObstacle(px, pz, obs)) {
        // 在障碍物内部，计算推力方向
        const ox = px - obs.cx
        const oz = pz - obs.cz
        const d = Math.hypot(ox, oz)
        if (d > 0.01) {
          const rotationY = obs.rotationY ?? 0
          // 根据旋转角度，找出最近的边缘方向推出
          const cos = Math.cos(rotationY)
          const sin = Math.sin(rotationY)
          const localX = ox * cos - oz * sin
          const localZ = ox * sin + oz * cos

          // 找出离哪条边缘最近（使用相同的膨胀值 0.25）
          const expand = 0.25
          const halfW = obs.width / 2 + expand
          const halfD = obs.depth / 2 + expand
          const distToEdgeX = halfW - Math.abs(localX)
          const distToEdgeZ = halfD - Math.abs(localZ)

          // 推向最近的边缘外部
          let pushX = 0, pushZ = 0
          if (distToEdgeX < distToEdgeZ) {
            // 推向 X 边缘
            pushX = localX > 0 ? distToEdgeX + 0.1 : -(distToEdgeX + 0.1)
          } else {
            // 推向 Z 边缘
            pushZ = localZ > 0 ? distToEdgeZ + 0.1 : -(distToEdgeZ + 0.1)
          }

          // 转回世界坐标
          rx += pushX * cos + pushZ * sin
          rz += -pushX * sin + pushZ * cos
        }
      }
    }
  }

  // 限制反向推力
  const backDot = rx * gx + rz * gz
  if (backDot < -0.3) {
    const excess = backDot + 0.3
    rx -= excess * gx
    rz -= excess * gz
  }

  const sx = gx + rx
  const sz = gz + rz
  const mag = Math.hypot(sx, sz) || 1
  return [sx / mag, sz / mag]
}