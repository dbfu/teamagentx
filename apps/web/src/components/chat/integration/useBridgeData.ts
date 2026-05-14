import { chatRoomApi, type ChatRoom } from '@/lib/agent-api'
import { bridgeApi, type BridgeBot, type BridgeEvent, type BridgePlatformDefinition, type BridgePlatformPlaybook, type Platform } from '@/lib/bridge-api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export interface BridgeData {
  platforms: BridgePlatformDefinition[]
  bots: BridgeBot[]
  rooms: ChatRoom[]
  playbook: BridgePlatformPlaybook | null
  events: BridgeEvent[]
  baseUrl: string
  loading: boolean
  hasError: boolean
  loadBots: (platform: Platform) => Promise<void>
  reload: () => void
}

export function useBridgeData(activePlatform: Platform): BridgeData {
  const [platforms, setPlatforms] = useState<BridgePlatformDefinition[]>([])
  const [bots, setBots] = useState<BridgeBot[]>([])
  const [rooms, setRooms] = useState<ChatRoom[]>([])
  const [playbook, setPlaybook] = useState<BridgePlatformPlaybook | null>(null)
  const [events, setEvents] = useState<BridgeEvent[]>([])
  const [baseUrl, setBaseUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const platformRequestIdRef = useRef(0)

  const reload = useCallback(() => setReloadTick((n) => n + 1), [])

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setHasError(false)
    try {
      const [platformDefs, roomRes, systemConfig] = await Promise.all([
        bridgeApi.listPlatforms(),
        chatRoomApi.getAll(),
        bridgeApi.getSystemConfig(),
      ])

      setPlatforms(platformDefs)
      setRooms(roomRes.data ?? [])
      setBaseUrl(systemConfig.baseUrl)
    } catch (err) {
      console.error('[bridge] loadInitial failed', err)
      setHasError(true)
      toast.error('加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadPlatformData = useCallback(async (platform: Platform) => {
    const requestId = ++platformRequestIdRef.current
    setHasError(false)
    try {
      const [botList, nextPlaybook, nextEvents] = await Promise.all([
        bridgeApi.listBots(platform),
        bridgeApi.getPlaybook(platform),
        bridgeApi.listEvents(platform, 20),
      ])

      if (requestId !== platformRequestIdRef.current) {
        return
      }

      setBots(botList)
      setPlaybook(nextPlaybook)
      setEvents(nextEvents)
    } catch (err) {
      console.error('[bridge] loadPlatformData failed', err)
      setHasError(true)
      toast.error('加载失败，请重试')
    }
  }, [])

  const loadBots = useCallback(async (platform: Platform) => {
    try {
      const botList = await bridgeApi.listBots(platform)
      setBots(botList)
    } catch (err) {
      console.error('[bridge] loadBots failed', err)
      toast.error('加载失败，请重试')
    }
  }, [])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  useEffect(() => {
    if (!loading) {
      void loadPlatformData(activePlatform)
    }
  }, [activePlatform, loading, reloadTick, loadPlatformData])

  return { platforms, bots, rooms, playbook, events, baseUrl, loading, hasError, loadBots, reload }
}
