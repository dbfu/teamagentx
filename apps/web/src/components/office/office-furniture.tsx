import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { CanvasTexture, RepeatWrapping } from 'three'
import { Text, useGLTF } from '@react-three/drei'

// GLB 模型基础路径：Web 端 BASE_URL 为 '/'，桌面端打包后为 './'（file:// 协议）。
// 必须用 import.meta.env.BASE_URL 前缀，否则绝对路径 /models 在 file:// 下会指向
// 文件系统根目录导致 404，3D 区域白屏。
const MODELS_BASE = `${import.meta.env.BASE_URL}models/`

// 按世界坐标映射瓷砖纹理：每块地面独立生成 canvas（白底 + 四边细缝），
// 所有地面共用同一套世界网格，砖缝跨区连续对齐。
// 地面绕 X 轴 -90° 平铺在 XZ 平面：局部 +X→世界 +X，局部 +Y→世界 -Z（故 V 方向取负）。
function floorTexture(width: number, height: number, cx: number, cz: number, tile = 1) {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(0,0,0,0.16)'
  ctx.lineWidth = 4
  ctx.strokeRect(0, 0, size, size)
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(width / tile, -height / tile)
  t.offset.set((cx - width / 2) / tile, (cz + height / 2) / tile)
  t.needsUpdate = true
  return t
}

type Vec3 = [number, number, number]

// 去除 Markdown 标记，终端只显示纯文本
function stripMarkdown(s: string): string {
  return s
    .replace(/```/g, '') // 代码块围栏
    .replace(/`([^`]+)`/g, '$1') // 行内代码
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 粗体
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1') // 斜体
    .replace(/~~([^~]+)~~/g, '$1') // 删除线
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 链接 → 文本
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 标题
    .replace(/^\s*>\s?/gm, '') // 引用
    // 表格分隔行（|---|:--:|）整行移除
    .replace(/^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/gm, '')
    .replace(/[ \t]*\|[ \t]*/g, '   ') // 表格竖线 → 空格分隔
    .replace(/^[-*_]{3,}\s*$/gm, '') // 分割线
    .replace(/^(\s*)[-*+]\s+/gm, '$1• ') // 无序列表 → •
}

// 显示器终端：内容超过可见行数时自动逐行向下滚动，滚到底回到顶部循环
const TERMINAL_VISIBLE_LINES = 10
function TerminalScreen({ text }: { text?: string }) {
  const lines = useMemo(
    () => (text && text.length ? stripMarkdown(text).split('\n') : ['$ 待命中…']),
    [text],
  )
  const [start, setStart] = useState(0)

  useEffect(() => {
    const maxStart = Math.max(0, lines.length - TERMINAL_VISIBLE_LINES)
    if (maxStart === 0) {
      setStart(0)
      return
    }
    const id = setInterval(() => {
      setStart((s) => (s >= maxStart ? 0 : s + 1))
    }, 900)
    return () => clearInterval(id)
  }, [lines.length])

  const maxStart = Math.max(0, lines.length - TERMINAL_VISIBLE_LINES)
  const safeStart = Math.min(start, maxStart)
  const visible = lines.slice(safeStart, safeStart + TERMINAL_VISIBLE_LINES).join('\n')

  return (
    <Text
      position={[-0.72, 1.82, -0.31]}
      anchorX="left"
      anchorY="top"
      fontSize={0.07}
      lineHeight={1.4}
      maxWidth={1.45}
      color="#7CFFB2"
      overflowWrap="break-word"
      clipRect={[0, -0.72, 1.45, 0]}
    >
      {`${visible}▋`}
    </Text>
  )
}

// 地面矩形（中心 + 宽深 + 颜色）
export interface FloorRect { cx: number; cz: number; w: number; d: number; color: string }

// 默认地面（房间之间间距2米）
const DEFAULT_FLOORS: FloorRect[] = [
  { cx: 0, cz: -3.5, w: 20, d: 9, color: '#edeff3' },
  { cx: -8, cz: 5, w: 6, d: 8, color: '#ecdcc4' },      // 左移1米，与老板办公室间距2米
  { cx: 0, cz: 5, w: 8, d: 8, color: '#ebe6da' },        // 老板办公室
  { cx: 8, cz: 5, w: 6, d: 8, color: '#e3e8ed' },        // 右移1米，与老板办公室间距2米
  { cx: 14.5, cz: 5, w: 7, d: 8, color: '#f2e7d6' },    // 右移1米，与健身房间距2米
  { cx: 14.5, cz: -3.5, w: 7, d: 9, color: '#e7dcf1' }, // 娱乐室
]

// 单块地面：纹理按自身尺寸平铺、按世界坐标对齐砖缝
function FloorTile({ rect, y = 0.005 }: { rect: FloorRect; y?: number }) {
  const tex = useMemo(
    () => floorTexture(rect.w, rect.d, rect.cx, rect.cz),
    [rect.w, rect.d, rect.cx, rect.cz],
  )
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rect.cx, y, rect.cz]} receiveShadow>
      <planeGeometry args={[rect.w, rect.d]} />
      <meshStandardMaterial map={tex} color={rect.color} />
    </mesh>
  )
}

// 记录已抹平的几何体，避免重复处理（clone 默认共享几何体）
const flattenedGeometries = new WeakSet<THREE.BufferGeometry>()

// 把地砖几何体的顶点 Y 全部抹平到同一高度，消除模型自带的高低差
function flattenFloorGeometry(scene: THREE.Object3D) {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const geom = mesh.geometry as THREE.BufferGeometry
    if (flattenedGeometries.has(geom)) return
    const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, 0) // 统一高度为 0（全部压平）
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()
    flattenedGeometries.add(geom)
  })
}

// 淡色材质缓存：地砖外观来自贴图（baseColor 为白），改 color 无效，
// 这里用贴图作为自发光贴图整体提亮，使颜色变淡（保留砖缝纹理）。
const lightenedMaterialCache = new Map<THREE.Material, THREE.Material>()
const LIGHTEN_AMOUNT = 0.6 // 0~1，自发光强度，越大越淡（越亮）
function getLightenedMaterial(mat: THREE.Material): THREE.Material {
  let m = lightenedMaterialCache.get(mat)
  if (!m) {
    m = mat.clone()
    const sm = m as THREE.MeshStandardMaterial
    sm.emissive = new THREE.Color('#ffffff')
    sm.emissiveMap = sm.map ?? null   // 用 baseColor 贴图按比例提亮
    sm.emissiveIntensity = LIGHTEN_AMOUNT
    sm.needsUpdate = true
    lightenedMaterialCache.set(mat, m)
  }
  return m
}

// 深色材质缓存：用 color 把贴图相乘压暗成深灰地板（房间外/走廊用）
const darkenedMaterialCache = new Map<THREE.Material, THREE.Material>()
const DARK_FLOOR_COLOR = '#7a7a82' // 走廊灰色地板颜色（与贴图相乘，太暗会看不清砖缝）
function getDarkenedMaterial(mat: THREE.Material): THREE.Material {
  let m = darkenedMaterialCache.get(mat)
  if (!m) {
    m = mat.clone()
    const sm = m as THREE.MeshStandardMaterial
    if (sm.color) sm.color.set(DARK_FLOOR_COLOR) // color 与贴图相乘 → 压暗
    sm.needsUpdate = true
    darkenedMaterialCache.set(mat, m)
  }
  return m
}

type FloorVariant = 'normal' | 'light' | 'dark'

function FloorTileModel({ position, scale = 2, variant = 'normal' }: { position: Vec3; scale?: number; variant?: FloorVariant }) {
  const { scene } = useGLTF(`${MODELS_BASE}floor.glb`)

  const clonedScene = useMemo(() => {
    // 抹平源几何体的高低差（共享几何体，只处理一次）
    flattenFloorGeometry(scene)
    // 简单克隆，保留原有材质
    const clone = scene.clone()
    // 按变体替换材质（材质 clone 默认共享，需替换为独立材质）
    if (variant !== 'normal') {
      const pick = variant === 'light' ? getLightenedMaterial : getDarkenedMaterial
      clone.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh || !mesh.material) return
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(pick)
          : pick(mesh.material)
      })
    }
    return clone as THREE.Group
  }, [scene, variant])

  return (
    <group position={position}>
      <primitive object={clonedScene} scale={scale} />
    </group>
  )
}

// 墙模型组件
export interface WallItem {
  pos: Vec3
  rotationY: number
  type: 'wall' | 'corner' | 'door' | 'window'
}

function WallModel({ position, rotationY = 0, type = 'wall', scale = 2 }: {
  position: Vec3
  rotationY?: number
  type?: 'wall' | 'corner' | 'door' | 'window'
  scale?: number
}) {
  const modelPath = useMemo(() => {
    switch (type) {
      case 'corner': return `${MODELS_BASE}wall-corner.glb`
      case 'door': return `${MODELS_BASE}wall-door-rotate.glb`
      case 'window': return `${MODELS_BASE}wall-window.glb`
      default: return `${MODELS_BASE}wall.glb`
    }
  }, [type])

  const { scene } = useGLTF(modelPath)

  const clonedScene = useMemo(() => {
    const clone = scene.clone()
    return clone as THREE.Group
  }, [scene])

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <primitive object={clonedScene} scale={scale} />
    </group>
  )
}

// 为房间生成四面墙（正方形房间），北墙完整一面，西墙单块调试
export function generateRoomWalls(cx: number, cz: number, roomSize: number): WallItem[] {
  const half = roomSize / 2
  const wallLength = 2 // 每块墙模型的长度（scale=2时）
  const wallsNeeded = Math.floor(roomSize / wallLength)
  const wallOffset = (roomSize - wallsNeeded * wallLength) / 2 + wallLength / 2
  const doorIndex = Math.floor(wallsNeeded / 2)

  const walls: WallItem[] = []

  // 北墙（后墙）完整一面墙
  for (let i = 0; i < wallsNeeded; i++) {
    const x = cx - half + wallOffset + i * wallLength
    const type = i === doorIndex ? 'window' : 'wall'
    walls.push({ pos: [x, 0, cz - half], rotationY: 0, type })
  }

  // 西墙（左墙）五块墙调试
  walls.push({ pos: [cx - 4.5, 0, cz - 3.5], rotationY: Math.PI / 2, type: 'wall' })
  walls.push({ pos: [cx - 4.5, 0, cz - 2], rotationY: Math.PI / 2, type: 'wall' })
  walls.push({ pos: [cx - 4.5, 0, cz], rotationY: Math.PI / 2, type: 'wall' })
  walls.push({ pos: [cx - 4.5, 0, cz + 2], rotationY: Math.PI / 2, type: 'wall' })
  walls.push({ pos: [cx - 4.5, 0, cz + 4], rotationY: Math.PI / 2, type: 'wall' })

  // 东墙（右墙）五块墙，镜像西墙
  walls.push({ pos: [cx + 3.5, 0, cz - 3.5], rotationY: -Math.PI / 2, type: 'wall' })
  walls.push({ pos: [cx + 3.5, 0, cz - 2], rotationY: -Math.PI / 2, type: 'wall' })
  walls.push({ pos: [cx + 3.5, 0, cz], rotationY: -Math.PI / 2, type: 'wall' })
  walls.push({ pos: [cx + 3.5, 0, cz + 2], rotationY: -Math.PI / 2, type: 'wall' })
  walls.push({ pos: [cx + 3.5, 0, cz + 4], rotationY: -Math.PI / 2, type: 'wall' })

  // 南墙（前墙）五块墙调试
  walls.push({ pos: [cx - 4, 0, cz + 5.5], rotationY: Math.PI, type: 'wall' })
  walls.push({ pos: [cx - 2, 0, cz + 5.5], rotationY: Math.PI, type: 'wall' })
  walls.push({ pos: [cx, 0, cz + 5.5], rotationY: Math.PI, type: 'wall' })
  walls.push({ pos: [cx + 2, 0, cz + 5.5], rotationY: Math.PI, type: 'wall' })
  walls.push({ pos: [cx + 3, 0, cz + 5.5], rotationY: Math.PI, type: 'wall' })  // 再往左0.5米  // 还原往左0.5米  // 往南0.5米  // 往南0.5米  // 往北0.5米

  return walls
}

// 房间：地板 + 各区地面颜色（房间随人数整间复制，floors 为所有房间地面列表）
export function Room({ floors }: { floors?: FloorRect[] }) {
  const list = floors && floors.length ? floors : DEFAULT_FLOORS
  // 兜底圆形地面半径：覆盖所有地面角点加边距
  const baseRadius = useMemo(() => {
    const cx = 3, cz = 1
    let maxR = 24
    for (const z of list) {
      const corners: [number, number][] = [
        [z.cx - z.w / 2, z.cz - z.d / 2],
        [z.cx + z.w / 2, z.cz - z.d / 2],
        [z.cx - z.w / 2, z.cz + z.d / 2],
        [z.cx + z.w / 2, z.cz + z.d / 2],
      ]
      for (const [x, zz] of corners) maxR = Math.max(maxR, Math.hypot(x - cx, zz - cz))
    }
    return maxR + 4
  }, [list])
  const baseTex = useMemo(() => floorTexture(baseRadius * 2, baseRadius * 2, 3, 1), [baseRadius])
  return (
    <group>
      {/* 圆形兜底地面：包住所有房间加少量边距 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3, -0.02, 1]} receiveShadow>
        <circleGeometry args={[baseRadius, 64]} />
        <meshStandardMaterial map={baseTex} color="#dcd6c8" />
      </mesh>
      {/* === 各房间地面 === */}
      {list.map((rect, i) => (
        <FloorTile key={i} rect={rect} />
      ))}
    </group>
  )
}

// 使用3D模型地板砖块的房间
export function RoomWithFloorTiles({ floors }: { floors?: FloorRect[] }) {
  const list = floors && floors.length ? floors : DEFAULT_FLOORS

  // 铺满整个地面：房间内用淡色地砖，房间外（走廊）用深灰地砖区分
  const tiles = useMemo(() => {
    const result: { pos: Vec3; scale: number; variant: FloorVariant }[] = []
    const tileSpacing = 2 // 砖块间距

    // 计算所有房间的边界范围（统一网格，保证砖缝跨房间对齐）
    let minX = Infinity, maxX = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    for (const rect of list) {
      minX = Math.min(minX, rect.cx - rect.w / 2)
      maxX = Math.max(maxX, rect.cx + rect.w / 2)
      minZ = Math.min(minZ, rect.cz - rect.d / 2)
      maxZ = Math.max(maxZ, rect.cz + rect.d / 2)
    }

    // 点是否落在任意房间矩形内
    const inAnyRoom = (x: number, z: number) =>
      list.some(
        (r) =>
          x >= r.cx - r.w / 2 && x <= r.cx + r.w / 2 &&
          z >= r.cz - r.d / 2 && z <= r.cz + r.d / 2,
      )

    // 覆盖到兜底正方形地面范围
    const centerX = (minX + maxX) / 2
    const centerZ = (minZ + maxZ) / 2
    const halfW = (maxX - minX) / 2
    const halfD = (maxZ - minZ) / 2
    const coverR = Math.max(halfW, halfD) + 8

    const cols = Math.ceil((coverR * 2) / tileSpacing)
    const rows = Math.ceil((coverR * 2) / tileSpacing)
    const startX = centerX - (cols * tileSpacing) / 2 + tileSpacing / 2
    const startZ = centerZ - (rows * tileSpacing) / 2 + tileSpacing / 2

    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = startX + i * tileSpacing
        const z = startZ + j * tileSpacing
        result.push({ pos: [x, 0, z], scale: 2, variant: inAnyRoom(x, z) ? 'light' : 'dark' })
      }
    }
    return result
  }, [list])

  // 计算覆盖区域的中心和半径（用于兜底圆形地面）
  const baseRadius = useMemo(() => {
    let minX = Infinity, maxX = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    for (const rect of list) {
      minX = Math.min(minX, rect.cx - rect.w / 2)
      maxX = Math.max(maxX, rect.cx + rect.w / 2)
      minZ = Math.min(minZ, rect.cz - rect.d / 2)
      maxZ = Math.max(maxZ, rect.cz + rect.d / 2)
    }
    const halfW = (maxX - minX) / 2
    const halfD = (maxZ - minZ) / 2
    return Math.max(halfW, halfD) + 8
  }, [list])

  const baseCenter = useMemo(() => {
    let minX = Infinity, maxX = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    for (const rect of list) {
      minX = Math.min(minX, rect.cx - rect.w / 2)
      maxX = Math.max(maxX, rect.cx + rect.w / 2)
      minZ = Math.min(minZ, rect.cz - rect.d / 2)
      maxZ = Math.max(maxZ, rect.cz + rect.d / 2)
    }
    return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }
  }, [list])

  return (
    <group>
      {/* 兜底平面地面（正方形） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[baseCenter.x, -0.02, baseCenter.z]} receiveShadow>
        <planeGeometry args={[baseRadius * 2, baseRadius * 2]} />
        <meshStandardMaterial color="#dcd6c8" />
      </mesh>
      {/* 3D模型地砖 */}
      {tiles.map((tile, i) => (
        <FloorTileModel key={i} position={tile.pos} scale={tile.scale} variant={tile.variant} />
      ))}
    </group>
  )
}

// 办公桌 + 显示器
export function Desk({
  position = [0, 0, 0] as Vec3,
  screenText,
  name,
  onScreenClick,
}: {
  position?: Vec3
  screenText?: string
  name?: string
  onScreenClick?: () => void
}) {
  return (
    <group position={position}>
      {/* 显示器上方工牌 */}
      {name && (
        <group position={[0, 2.05, -0.34]} scale={1.4}>
          {/* 牌面 */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.52, 0.22, 0.016]} />
            <meshStandardMaterial color="#ffffff" roughness={1} emissive="#ffffff" emissiveIntensity={0.9} />
          </mesh>
          <Text
            position={[0, 0, 0.012]}
            fontSize={0.11}
            fontWeight={700}
            letterSpacing={0.05}
            color="#2b2b2b"
            anchorX="center"
            anchorY="middle"
            maxWidth={0.48}
          >
            {name}
          </Text>
        </group>
      )}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.07, 0.9]} />
        <meshStandardMaterial color="#caa472" />
      </mesh>
      {([[-0.78, 0.36, -0.4], [0.78, 0.36, -0.4], [-0.78, 0.36, 0.4], [0.78, 0.36, 0.4]] as Vec3[]).map((p, i) => (
        <mesh key={i} position={p} castShadow>
          <boxGeometry args={[0.07, 0.72, 0.07]} />
          <meshStandardMaterial color="#9b7b4f" />
        </mesh>
      ))}
      <mesh
        position={[0, 1.48, -0.34]}
        castShadow
        onClick={onScreenClick ? (e) => { e.stopPropagation(); onScreenClick() } : undefined}
        onPointerOver={onScreenClick ? (e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' } : undefined}
        onPointerOut={onScreenClick ? () => { document.body.style.cursor = 'auto' } : undefined}
      >
        <boxGeometry args={[1.6, 0.8, 0.04]} />
        <meshStandardMaterial color="#1f2937" emissive="#1e3a8a" emissiveIntensity={0.4} />
      </mesh>
      <TerminalScreen text={screenText} />
      {/* 显示器支架：从桌面接到显示器底部 */}
      <mesh position={[0, 0.92, -0.34]} castShadow>
        <boxGeometry args={[0.13, 0.34, 0.07]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      {/* 支架底座（落在桌面上） */}
      <mesh position={[0, 0.775, -0.32]} castShadow>
        <boxGeometry args={[0.34, 0.03, 0.2]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
    </group>
  )
}

// 沙发
export function Sofa({
  position,
  width = 3.0,
  rotationY = 0,
}: {
  position: Vec3
  width?: number
  rotationY?: number
}) {
  const fabric = '#6b7280'
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 底座（接地，避免悬浮） */}
      <mesh position={[0, 0.145, 0]} castShadow>
        <boxGeometry args={[width, 0.29, 0.78]} />
        <meshStandardMaterial color="#586070" />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.22, 0.8]} />
        <meshStandardMaterial color={fabric} />
      </mesh>
      <mesh position={[0, 0.68, -0.32]} castShadow>
        <boxGeometry args={[width, 0.55, 0.18]} />
        <meshStandardMaterial color={fabric} />
      </mesh>
      {[-width / 2 + 0.09, width / 2 - 0.09].map((x) => (
        <mesh key={x} position={[x, 0.52, 0.01]} castShadow>
          <boxGeometry args={[0.2, 0.42, 0.82]} />
          <meshStandardMaterial color="#586070" />
        </mesh>
      ))}
    </group>
  )
}

// 一把椅子
function Chair({ position, rotationY }: { position: Vec3; rotationY: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.46, 0]} castShadow>
        <boxGeometry args={[0.42, 0.07, 0.42]} />
        <meshStandardMaterial color="#9b7b4f" />
      </mesh>
      <mesh position={[0, 0.66, 0.18]} castShadow>
        <boxGeometry args={[0.42, 0.42, 0.06]} />
        <meshStandardMaterial color="#9b7b4f" />
      </mesh>
      {([[-0.17, 0.23, -0.17], [0.17, 0.23, -0.17], [-0.17, 0.23, 0.17], [0.17, 0.23, 0.17]] as Vec3[]).map((p, i) => (
        <mesh key={i} position={p} castShadow>
          <boxGeometry args={[0.05, 0.46, 0.05]} />
          <meshStandardMaterial color="#7a6037" />
        </mesh>
      ))}
    </group>
  )
}

// 茶水间：圆桌 + 四椅 + 茶点
export function BreakTable({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.6, 0.6, 0.07, 24]} />
        <meshStandardMaterial color="#e7d3b3" />
      </mesh>
      <mesh position={[0, 0.36, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 0.72, 12]} />
        <meshStandardMaterial color="#b08c5a" />
      </mesh>
      {/* 茶点 */}
      <mesh position={[0, 0.77, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.14, 0.03, 20]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[0, 0.83, 0]} castShadow>
        <sphereGeometry args={[0.07, 16, 12]} />
        <meshStandardMaterial color="#c2752f" />
      </mesh>
      <mesh position={[0.28, 0.84, 0.1]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.14, 12]} />
        <meshStandardMaterial color="#86c5ff" />
      </mesh>
      {/* 四把椅子 */}
      <Chair position={[0, 0, -0.85]} rotationY={Math.PI} />
      <Chair position={[0, 0, 0.85]} rotationY={0} />
      <Chair position={[-0.85, 0, 0]} rotationY={-Math.PI / 2} />
      <Chair position={[0.85, 0, 0]} rotationY={Math.PI / 2} />
    </group>
  )
}

// 瑜伽垫
export function YogaMat({ position, color = '#6bb36b' }: { position: Vec3; color?: string }) {
  return (
    <mesh position={[position[0], 0.025, position[2]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[0.7, 1.4]} />
      <meshStandardMaterial color={color} />
    </mesh>
  )
}

// 哑铃架
export function DumbbellRack({ position }: { position: Vec3 }) {
  const Dumbbell = ({ y }: { y: number }) => (
    <group position={[0, y, 0.18]} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.5, 10]} />
        <meshStandardMaterial color="#9aa3b2" />
      </mesh>
      {([-0.27, 0.27] as number[]).map((x) => (
        <mesh key={x} position={[0, x, 0]} castShadow>
          <cylinderGeometry args={[0.11, 0.11, 0.12, 14]} />
          <meshStandardMaterial color="#2b3140" />
        </mesh>
      ))}
    </group>
  )
  return (
    <group position={position}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.9, 0.06, 0.45]} />
        <meshStandardMaterial color="#475569" />
      </mesh>
      <mesh position={[0, 0.25, 0]} castShadow>
        <boxGeometry args={[0.9, 0.06, 0.45]} />
        <meshStandardMaterial color="#475569" />
      </mesh>
      {([-0.42, 0.42] as number[]).map((x) => (
        <mesh key={x} position={[x, 0.3, 0]} castShadow>
          <boxGeometry args={[0.06, 0.6, 0.45]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
      ))}
      <Dumbbell y={0.58} />
      <Dumbbell y={0.33} />
    </group>
  )
}

// 跑步机
export function Treadmill({ position, rotationY = 0 }: { position: Vec3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.16, 1.5]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 0.21, 0.1]} castShadow>
        <boxGeometry args={[0.5, 0.04, 1.1]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {([-0.28, 0.28] as number[]).map((x) => (
        <mesh key={x} position={[x, 0.6, -0.6]} castShadow>
          <boxGeometry args={[0.05, 0.95, 0.05]} />
          <meshStandardMaterial color="#475569" />
        </mesh>
      ))}
      <mesh position={[0, 1.05, -0.62]} rotation={[0.4, 0, 0]} castShadow>
        <boxGeometry args={[0.62, 0.32, 0.05]} />
        <meshStandardMaterial color="#0f172a" emissive="#0ea5e9" emissiveIntensity={0.25} />
      </mesh>
    </group>
  )
}

// 角落绿植
export function Plant({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.14, 0.4, 16]} />
        <meshStandardMaterial color="#c2703a" />
      </mesh>
      <mesh position={[0, 0.6, 0]} castShadow>
        <sphereGeometry args={[0.32, 16, 12]} />
        <meshStandardMaterial color="#3f9d52" />
      </mesh>
      <mesh position={[0.15, 0.85, 0.05]} castShadow>
        <sphereGeometry args={[0.22, 16, 12]} />
        <meshStandardMaterial color="#4cb463" />
      </mesh>
    </group>
  )
}

// 床（休息室用）
export function Bed({ position, rotationY = 0 }: { position: Vec3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 床架 */}
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.5, 1.2]} />
        <meshStandardMaterial color="#8b7355" />
      </mesh>
      {/* 床垫 */}
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.12, 1.1]} />
        <meshStandardMaterial color="#f5f5f5" />
      </mesh>
      {/* 床单 */}
      <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.0, 0.04, 1.0]} />
        <meshStandardMaterial color="#e8e4d9" />
      </mesh>
      {/* 枕头 */}
      <mesh position={[0.7, 0.68, 0]} castShadow>
        <boxGeometry args={[0.35, 0.12, 0.8]} />
        <meshStandardMaterial color="#fff8f0" />
      </mesh>
      {/* 床头板 */}
      <mesh position={[1.1, 0.65, 0]} castShadow>
        <boxGeometry args={[0.08, 0.9, 1.2]} />
        <meshStandardMaterial color="#5c4033" />
      </mesh>
    </group>
  )
}

// 老板办公桌（更大气）
export function BossDesk({ position, rotationY = 0 }: { position: Vec3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 大型办公桌 */}
      <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.08, 1.2]} />
        <meshStandardMaterial color="#4a3728" />
      </mesh>
      {/* 桌腿 */}
      {[-1.1, 1.1].map((x) => (
        <mesh key={x} position={[x, 0.38, 0]} castShadow>
          <boxGeometry args={[0.1, 0.76, 1.0]} />
          <meshStandardMaterial color="#3d2d20" />
        </mesh>
      ))}
      {/* 大显示器 */}
      <mesh position={[0.5, 1.15, -0.35]} castShadow>
        <boxGeometry args={[0.7, 0.45, 0.04]} />
        <meshStandardMaterial color="#1f2937" emissive="#1e40af" emissiveIntensity={0.3} />
      </mesh>
      {/* 显示器支架 */}
      <mesh position={[0.5, 0.95, -0.35]}>
        <boxGeometry args={[0.12, 0.15, 0.08]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      {/* 文件架 */}
      <mesh position={[-0.8, 0.82, -0.3]} castShadow>
        <boxGeometry args={[0.4, 0.3, 0.25]} />
        <meshStandardMaterial color="#8b7355" />
      </mesh>
      {/* 茶杯 */}
      <mesh position={[0.9, 0.85, 0.2]} castShadow>
        <cylinderGeometry args={[0.05, 0.04, 0.1, 16]} />
        <meshStandardMaterial color="#fff" />
      </mesh>
    </group>
  )
}

// 老板椅（更舒适）
export function BossChair({ position, rotationY = 0 }: { position: Vec3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 座椅 */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.6, 0.12, 0.6]} />
        <meshStandardMaterial color="#2d2d2d" />
      </mesh>
      {/* 座椅垫 */}
      <mesh position={[0, 0.58, 0]} castShadow>
        <boxGeometry args={[0.55, 0.06, 0.55]} />
        <meshStandardMaterial color="#4a4a4a" />
      </mesh>
      {/* 靠背 */}
      <mesh position={[0, 0.85, -0.25]} castShadow>
        <boxGeometry args={[0.55, 0.7, 0.1]} />
        <meshStandardMaterial color="#2d2d2d" />
      </mesh>
      {/* 靠背垫 */}
      <mesh position={[0, 0.85, -0.2]} castShadow>
        <boxGeometry args={[0.5, 0.65, 0.06]} />
        <meshStandardMaterial color="#4a4a4a" />
      </mesh>
      {/* 底座 */}
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.25, 0.05, 20]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      {/* 五爪底座 */}
      {[0, 72, 144, 216, 288].map((angle) => (
        <mesh key={angle} position={[0, 0.1, 0]} rotation={[0, (angle * Math.PI) / 180, 0]} castShadow>
          <boxGeometry args={[0.35, 0.04, 0.06]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      ))}
    </group>
  )
}

// 书柜
export function Bookshelf({ position, rotationY = 0 }: { position: Vec3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 柜体 */}
      <mesh position={[0, 1.0, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 2.0, 0.4]} />
        <meshStandardMaterial color="#5c4033" />
      </mesh>
      {/* 隔层 */}
      {[0.3, 0.9, 1.5].map((y) => (
        <mesh key={y} position={[0, y, 0]} castShadow>
          <boxGeometry args={[1.4, 0.05, 0.35]} />
          <meshStandardMaterial color="#8b7355" />
        </mesh>
      ))}
      {/* 书籍 */}
      <mesh position={[-0.4, 0.5, 0]} castShadow>
        <boxGeometry args={[0.15, 0.35, 0.3]} />
        <meshStandardMaterial color="#3b82f6" />
      </mesh>
      <mesh position={[-0.2, 0.5, 0]} castShadow>
        <boxGeometry args={[0.12, 0.32, 0.28]} />
        <meshStandardMaterial color="#10b981" />
      </mesh>
      <mesh position={[0.05, 0.5, 0]} castShadow>
        <boxGeometry args={[0.18, 0.38, 0.32]} />
        <meshStandardMaterial color="#f59e0b" />
      </mesh>
      <mesh position={[0.3, 0.5, 0]} castShadow>
        <boxGeometry args={[0.14, 0.3, 0.26]} />
        <meshStandardMaterial color="#ef4444" />
      </mesh>
    </group>
  )
}

// 电视（娱乐室）
export function TV({ position, rotationY = 0 }: { position: Vec3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 电视柜 */}
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.0, 0.7, 0.45]} />
        <meshStandardMaterial color="#3d3d3d" />
      </mesh>
      {/* 大电视屏幕 */}
      <mesh position={[0, 1.2, 0.1]} castShadow>
        <boxGeometry args={[1.8, 1.0, 0.05]} />
        <meshStandardMaterial color="#1a1a1a" emissive="#4a90d9" emissiveIntensity={0.2} />
      </mesh>
      {/* 电视边框 */}
      <mesh position={[0, 1.2, 0.08]}>
        <boxGeometry args={[1.85, 1.05, 0.02]} />
        <meshStandardMaterial color="#2d2d2d" />
      </mesh>
    </group>
  )
}

// 游戏机/游戏桌
export function GameConsole({ position, rotationY = 0 }: { position: Vec3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 游戏桌 */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.8, 0.6]} />
        <meshStandardMaterial color="#2d2d2d" />
      </mesh>
      {/* 屏幕 */}
      <mesh position={[0, 0.95, -0.15]} castShadow>
        <boxGeometry args={[1.0, 0.6, 0.03]} />
        <meshStandardMaterial color="#1a1a1a" emissive="#00ff88" emissiveIntensity={0.3} />
      </mesh>
      {/* 控制面板 */}
      <mesh position={[0, 0.45, 0.1]} castShadow>
        <boxGeometry args={[0.8, 0.05, 0.3]} />
        <meshStandardMaterial color="#4a4a4a" />
      </mesh>
    </group>
  )
}

// 街机/游戏机柜（立式，玩家站在正面操作）
export function ArcadeMachine({ position, rotationY = 0 }: { position: Vec3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 机身 */}
      <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.8, 1.7, 0.7]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>
      {/* 顶灯招牌 */}
      <mesh position={[0, 1.78, 0.05]} castShadow>
        <boxGeometry args={[0.82, 0.28, 0.72]} />
        <meshStandardMaterial color="#2d2d2d" emissive="#ffcc00" emissiveIntensity={0.45} />
      </mesh>
      {/* 屏幕（正面朝 +Z，略上仰） */}
      <mesh position={[0, 1.25, 0.36]} rotation={[-0.25, 0, 0]} castShadow>
        <boxGeometry args={[0.62, 0.5, 0.04]} />
        <meshStandardMaterial color="#0a0a14" emissive="#00e5ff" emissiveIntensity={0.4} />
      </mesh>
      {/* 控制台斜面 */}
      <mesh position={[0, 0.92, 0.42]} rotation={[0.7, 0, 0]} castShadow>
        <boxGeometry args={[0.7, 0.34, 0.05]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      {/* 摇杆 */}
      <mesh position={[-0.16, 1.0, 0.5]} castShadow>
        <cylinderGeometry args={[0.025, 0.025, 0.16, 12]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh position={[-0.16, 1.09, 0.5]} castShadow>
        <sphereGeometry args={[0.05, 12, 10]} />
        <meshStandardMaterial color="#e11d48" />
      </mesh>
      {/* 按钮 */}
      {[[0.08, '#fbbf24'], [0.2, '#22c55e'], [0.14, '#3b82f6']].map(([x, c], i) => (
        <mesh key={i} position={[x as number, 1.0, 0.48]} rotation={[0.7, 0, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.04, 12]} />
          <meshStandardMaterial color={c as string} />
        </mesh>
      ))}
    </group>
  )
}

// 地垫/坐垫（娱乐室席地而坐用）
export function FloorCushion({ position, color = '#7c5cbf' }: { position: Vec3; color?: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.16, 0.7]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  )
}

// 沙发床（可躺可坐）
export function LoungeSofa({ position, rotationY = 0 }: { position: Vec3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 底座（接地，避免悬浮） */}
      <mesh position={[0, 0.0875, 0]} castShadow>
        <boxGeometry args={[2.0, 0.175, 0.88]} />
        <meshStandardMaterial color="#6b4423" />
      </mesh>
      {/* 座垫 */}
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.0, 0.25, 0.9]} />
        <meshStandardMaterial color="#8b5a2b" />
      </mesh>
      {/* 靠背 */}
      <mesh position={[0, 0.55, -0.35]} castShadow>
        <boxGeometry args={[2.0, 0.5, 0.2]} />
        <meshStandardMaterial color="#8b5a2b" />
      </mesh>
      {/* 扶手 */}
      <mesh position={[-1.0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.15, 0.45, 0.9]} />
        <meshStandardMaterial color="#6b4423" />
      </mesh>
      <mesh position={[1.0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.15, 0.45, 0.9]} />
        <meshStandardMaterial color="#6b4423" />
      </mesh>
    </group>
  )
}

// 按类型渲染单件家具（供「整间复制」的布局统一渲染）
export type FurnKind =
  | 'table' | 'sofa' | 'bed' | 'mat' | 'cushion'
  | 'tv' | 'console' | 'arcade' | 'dumbbell' | 'treadmill' | 'plant'
export interface FurnItem { kind: FurnKind; pos: Vec3; rotationY: number; color?: string }

export function OfficeFurnitureItem({ item }: { item: FurnItem }) {
  const { kind, pos, rotationY, color } = item
  switch (kind) {
    case 'table': return <BreakTable position={pos} />
    case 'sofa': return <Sofa position={pos} width={4} rotationY={rotationY} />
    case 'bed': return <Bed position={pos} rotationY={rotationY} />
    case 'mat': return <YogaMat position={pos} color={color} />
    case 'cushion': return <FloorCushion position={pos} color={color} />
    case 'tv': return <TV position={pos} rotationY={rotationY} />
    case 'console': return <GameConsole position={pos} rotationY={rotationY} />
    case 'arcade': return <ArcadeMachine position={pos} rotationY={rotationY} />
    case 'dumbbell': return <DumbbellRack position={pos} />
    case 'treadmill': return <Treadmill position={pos} rotationY={rotationY} />
    case 'plant': return <Plant position={pos} />
    default: return null
  }
}

// 渲染单个墙模型
export function RoomWallItem({ wall }: { wall: WallItem }) {
  return <WallModel position={wall.pos} rotationY={wall.rotationY} type={wall.type} />
}

// 是否显示墙体（设为 false 可隐藏所有墙，碰撞仍然生效）
export const SHOW_WALLS = false

// 为所有房间渲染墙（接收 walls 数组）
export function RoomWalls({ walls }: { walls?: WallItem[] }) {
  if (!SHOW_WALLS || !walls || walls.length === 0) return null
  return (
    <group>
      {walls.map((wall, i) => (
        <RoomWallItem key={i} wall={wall} />
      ))}
    </group>
  )
}

// 预加载地板和墙模型
useGLTF.preload(`${MODELS_BASE}floor.glb`)
useGLTF.preload(`${MODELS_BASE}wall.glb`)
useGLTF.preload(`${MODELS_BASE}wall-corner.glb`)
useGLTF.preload(`${MODELS_BASE}wall-door-rotate.glb`)
useGLTF.preload(`${MODELS_BASE}wall-window.glb`)
