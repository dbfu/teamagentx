import type { Obstacle } from './office-obstacles'
import { isInRectObstacle } from './office-obstacles'

const CELL = 0.5       // 格子边长（世界单位）

// 网格范围放大，容纳「整间复制」向各方向铺开的房间
export const MIN_X = -26
export const MAX_X = 40
export const MIN_Z = -14
export const MAX_Z = 32
export const COLS = Math.round((MAX_X - MIN_X) / CELL) + 1  // 61
export const ROWS = Math.round((MAX_Z - MIN_Z) / CELL) + 1  // 49

export type WalkGrid = Uint8Array  // 1=可走, 0=障碍

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

export function w2g(wx: number, wz: number): [number, number] {
  return [
    clamp(Math.round((wx - MIN_X) / CELL), 0, COLS - 1),
    clamp(Math.round((wz - MIN_Z) / CELL), 0, ROWS - 1),
  ]
}

export function g2w(gx: number, gz: number): [number, number] {
  return [MIN_X + gx * CELL, MIN_Z + gz * CELL]
}

/** 根据障碍物列表构建可行走网格（每次障碍物变化时重建一次） */
export function buildWalkableGrid(obstacles: Obstacle[]): WalkGrid {
  const grid = new Uint8Array(COLS * ROWS).fill(1)
  for (let gx = 0; gx < COLS; gx++) {
    const wx = MIN_X + gx * CELL
    for (let gz = 0; gz < ROWS; gz++) {
      const wz = MIN_Z + gz * CELL
      for (const obs of obstacles) {
        if (isInRectObstacle(wx, wz, obs)) {
          grid[gx * ROWS + gz] = 0
          break
        }
      }
    }
  }
  return grid
}

/** 判断世界坐标是否可走 */
export function isWalkable(wx: number, wz: number, grid: WalkGrid): boolean {
  const [gx, gz] = w2g(wx, wz)
  return grid[gx * ROWS + gz] === 1
}

/** 将世界坐标吸附到最近的可走格子 */
export function snapToWalkable(wx: number, wz: number, grid: WalkGrid): [number, number] {
  const [gx, gz] = w2g(wx, wz)
  if (grid[gx * ROWS + gz]) return [wx, wz]
  for (let r = 1; r <= 14; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue
        const nx = gx + dx, nz = gz + dz
        if (nx >= 0 && nx < COLS && nz >= 0 && nz < ROWS && grid[nx * ROWS + nz]) {
          return g2w(nx, nz)
        }
      }
    }
  }
  return [wx, wz]
}

const DIRS8: [number, number, number][] = [
  [1, 0, 1],     [-1, 0, 1],    [0, 1, 1],    [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
]

/**
 * A* 寻路，返回世界坐标路径 [x, z][]。
 * 目标点即使在障碍物内部也能到达（如床、沙发），不会因此失败。
 */
export function findPath(
  sx: number, sz: number,
  ex: number, ez: number,
  grid: WalkGrid,
): [number, number][] {
  const [sgx, sgz] = w2g(sx, sz)
  const [egx, egz] = w2g(ex, ez)
  if (sgx === egx && sgz === egz) return [[ex, ez]]

  const size = COLS * ROWS
  const ei = egx * ROWS + egz

  // 目标格永远视为可走（角色要站在目的地，不能因此被挡住）
  const canWalk = (i: number) => i === ei || grid[i] === 1

  const gScore = new Float32Array(size).fill(Infinity)
  const fScore = new Float32Array(size).fill(Infinity)
  const parent = new Int32Array(size).fill(-1)
  const inOpen = new Uint8Array(size)

  const idxOf = (gx: number, gz: number) => gx * ROWS + gz
  const h = (gx: number, gz: number) => Math.hypot(gx - egx, gz - egz)

  const si = idxOf(sgx, sgz)
  gScore[si] = 0
  fScore[si] = h(sgx, sgz)
  inOpen[si] = 1
  const open: number[] = [si]

  while (open.length > 0) {
    // 弹出 fScore 最小的节点（线性扫描，对 ~3000 格足够快）
    let li = 0
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[li]]) li = i
    }
    const ci = open.splice(li, 1)[0]
    inOpen[ci] = 0

    if (ci === ei) {
      // 回溯路径
      const raw: [number, number][] = []
      let cur = ci
      while (cur !== -1) {
        raw.unshift(g2w(Math.floor(cur / ROWS), cur % ROWS))
        cur = parent[cur]
      }
      return smoothPath(raw, grid, ei)
    }

    const cgx = Math.floor(ci / ROWS)
    const cgz = ci % ROWS

    for (const [dx, dz, cost] of DIRS8) {
      const nx = cgx + dx
      const nz = cgz + dz
      if (nx < 0 || nx >= COLS || nz < 0 || nz >= ROWS) continue
      // 对角线移动：检查两侧格子，防止穿墙角
      if (dx !== 0 && dz !== 0) {
        if (!canWalk(idxOf(cgx + dx, cgz)) || !canWalk(idxOf(cgx, cgz + dz))) continue
      }
      const ni = idxOf(nx, nz)
      if (!canWalk(ni)) continue
      const tg = gScore[ci] + cost
      if (tg < gScore[ni]) {
        parent[ni] = ci
        gScore[ni] = tg
        fScore[ni] = tg + h(nx, nz)
        if (!inOpen[ni]) {
          inOpen[ni] = 1
          open.push(ni)
        }
      }
    }
  }

  // 找不到路径时直接返回目标（兜底）
  return [[ex, ez]]
}

// Bresenham 直线视线检测
function hasLOS(
  ax: number, az: number,
  bx: number, bz: number,
  grid: WalkGrid,
  allowIdx: number,
): boolean {
  let [x, z] = w2g(ax, az)
  const [ex, ez] = w2g(bx, bz)
  const absDx = Math.abs(ex - x)
  const absDz = Math.abs(ez - z)
  const sx2 = x < ex ? 1 : -1
  const sz2 = z < ez ? 1 : -1
  let err = absDx - absDz
  for (let iter = 0; iter < 300; iter++) {
    const ni = x * ROWS + z
    if (ni !== allowIdx && !grid[ni]) return false
    if (x === ex && z === ez) return true
    const e2 = 2 * err
    if (e2 > -absDz) { err -= absDz; x += sx2 }
    if (e2 < absDx) { err += absDx; z += sz2 }
  }
  return true
}

/** 字符串拉直：移除多余的中间路点，让路径更流畅 */
function smoothPath(path: [number, number][], grid: WalkGrid, goalIdx: number): [number, number][] {
  if (path.length <= 2) return path
  const result: [number, number][] = [path[0]]
  let i = 0
  while (i < path.length - 1) {
    let j = path.length - 1
    while (j > i + 1 && !hasLOS(path[i][0], path[i][1], path[j][0], path[j][1], grid, goalIdx)) {
      j--
    }
    result.push(path[j])
    i = j
  }
  return result
}
