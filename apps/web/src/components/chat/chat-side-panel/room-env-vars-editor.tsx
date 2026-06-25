import { chatRoomApi } from '@/lib/agent-api';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface EnvVarRow {
  key: string
  value: string
  description: string
}

interface RoomEnvVarsEditorProps {
  chatRoomId: string
  /** ChatRoom.envVars，JSON 数组字符串 */
  envVars: string | null
  /** 保存成功后刷新群聊数据 */
  onSaved: () => void
  /** 保存成功后关闭弹框 */
  onClose?: () => void
  /** 状态变化回调，用于通知父组件 */
  onStateChange?: (state: { dirty: boolean; hasErrors: boolean; saving: boolean }) => void
}

export interface RoomEnvVarsEditorRef {
  save: () => void
  addRow: () => void
  getState: () => { dirty: boolean; hasErrors: boolean; saving: boolean }
}

const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

function parseRows(raw: string | null): EnvVarRow[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        key: typeof item.key === 'string' ? item.key : '',
        value: typeof item.value === 'string' ? item.value : '',
        description: typeof item.description === 'string' ? item.description : '',
      }))
  } catch {
    return []
  }
}

export const RoomEnvVarsEditor = forwardRef<RoomEnvVarsEditorRef, RoomEnvVarsEditorProps>(
  function RoomEnvVarsEditor({ chatRoomId, envVars, onSaved, onClose, onStateChange }, ref) {
    const { t } = useTranslation()
    const [rows, setRows] = useState<EnvVarRow[]>(() => parseRows(envVars))
    const [revealed, setRevealed] = useState<Record<number, boolean>>({})
    const [saving, setSaving] = useState(false)
    const [dirty, setDirty] = useState(false)

    useEffect(() => {
      setRows(parseRows(envVars))
      setRevealed({})
      setDirty(false)
    }, [chatRoomId, envVars])

    // 校验：key 非空、格式合法、不重复
    const keyErrors = useMemo(() => {
      const errors: Record<number, string> = {}
      const seen = new Map<string, number>()
      rows.forEach((row, index) => {
        const key = row.key.trim()
        if (!key) {
          errors[index] = t('chat.envVars.keyEmpty')
          return
        }
        if (!VALID_ENV_KEY.test(key)) {
          errors[index] = t('chat.envVars.keyInvalid')
          return
        }
        if (seen.has(key)) {
          errors[index] = t('chat.envVars.keyDuplicate')
          return
        }
        seen.set(key, index)
      })
      return errors
    }, [rows, t])

    const hasErrors = Object.keys(keyErrors).length > 0

    // 状态变化回调
    useEffect(() => {
      onStateChange?.({ dirty, hasErrors, saving })
    }, [dirty, hasErrors, saving, onStateChange])

    const updateRow = (index: number, patch: Partial<EnvVarRow>) => {
      setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
      setDirty(true)
    }

    const addRow = () => {
      setRows((prev) => [...prev, { key: '', value: '', description: '' }])
      setDirty(true)
    }

    const removeRow = (index: number) => {
      setRows((prev) => prev.filter((_, i) => i !== index))
      setRevealed((prev) => {
        const next = { ...prev }
        delete next[index]
        return next
      })
      setDirty(true)
    }

    const handleSave = async () => {
      if (hasErrors) {
        toast.error(t('chat.envVars.fixKeyFirst'))
        return
      }
      setSaving(true)
      try {
        const payload = rows.map((row) => ({
          key: row.key.trim(),
          value: row.value,
          description: row.description.trim() || undefined,
        }))
        const response = await chatRoomApi.update(chatRoomId, {
          envVars: payload.length > 0 ? JSON.stringify(payload) : null,
        })
        if (response.success) {
          const skipped = response.skippedReservedKeys ?? []
          if (skipped.length > 0) {
            toast.warning(t('chat.envVars.reservedKeysIgnored', { keys: skipped.join(', ') }))
          } else {
            toast.success(t('chat.envVars.saved'))
          }
          setDirty(false)
          onSaved()
          onClose?.()
        } else {
          toast.error(t('chat.envVars.saveFailed'))
        }
      } finally {
        setSaving(false)
      }
    }

    // 暴露方法给父组件
    // 注意：handleSave 闭包捕获了 rows，必须把 rows 纳入依赖，
    // 否则连续编辑（dirty 已为 true、hasErrors 不变）时 ref.save 会停留在旧快照，
    // 点击保存只会持久化最早一次输入，表现为"保存后再次打开还是前面的值"。
    useImperativeHandle(ref, () => ({
      save: handleSave,
      addRow,
      getState: () => ({ dirty, hasErrors, saving }),
    }), [rows, dirty, hasErrors, saving])

  return (
    <div className="relative">
      <label className="mb-2 block text-sm font-medium text-muted-foreground">{t('chat.envVars.label')}</label>
      <p className="mb-3 text-xs text-muted-foreground">
        {t('chat.envVars.hint')}
      </p>

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="rounded-lg border border-input p-2.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 space-y-2">
                  <div>
                    <input
                      value={row.key}
                      onChange={(e) => updateRow(index, { key: e.target.value })}
                      placeholder={t('chat.envVars.keyPlaceholder')}
                      className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                      disabled={saving}
                      spellCheck={false}
                    />
                    {keyErrors[index] && (
                      <span className="mt-1 block text-xs text-red-500">{keyErrors[index]}</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={revealed[index] ? 'text' : 'password'}
                      value={row.value}
                      onChange={(e) => updateRow(index, { value: e.target.value })}
                      placeholder={t('chat.envVars.valuePlaceholder')}
                      autoComplete="new-password"
                      className="w-full rounded-lg border border-input bg-background px-3 py-1.5 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                      disabled={saving}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => setRevealed((prev) => ({ ...prev, [index]: !prev[index] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      aria-label={revealed[index] ? t('chat.envVars.hideValue') : t('chat.envVars.showValue')}
                    >
                      {revealed[index] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <input
                    value={row.description}
                    onChange={(e) => updateRow(index, { description: e.target.value })}
                    placeholder={t('chat.envVars.descriptionPlaceholder')}
                    className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                    disabled={saving}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-red-500"
                  disabled={saving}
                  aria-label={t('chat.envVars.deleteVariable')}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
