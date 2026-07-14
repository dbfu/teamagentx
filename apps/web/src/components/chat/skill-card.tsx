import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SharedSkill, type SkillColor } from '@/lib/skill-api'
import { cn } from '@/lib/utils'
import { Check, Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const SKILL_COLOR_OPTIONS: Array<{
  value: SkillColor
  labelKey: string
  swatchClassName: string
  initialsClassName: string
}> = [
  {
    value: 'gray',
    labelKey: 'skill.colorGray',
    swatchClassName: 'bg-gray-400',
    initialsClassName: 'bg-gray-500 text-white',
  },
  {
    value: 'red',
    labelKey: 'skill.colorRed',
    swatchClassName: 'bg-red-500',
    initialsClassName: 'bg-red-500 text-white',
  },
  {
    value: 'orange',
    labelKey: 'skill.colorOrange',
    swatchClassName: 'bg-orange-500',
    initialsClassName: 'bg-orange-500 text-white',
  },
  {
    value: 'yellow',
    labelKey: 'skill.colorYellow',
    swatchClassName: 'bg-yellow-400',
    initialsClassName: 'bg-yellow-400 text-yellow-950',
  },
  {
    value: 'green',
    labelKey: 'skill.colorGreen',
    swatchClassName: 'bg-green-500',
    initialsClassName: 'bg-green-500 text-white',
  },
  {
    value: 'blue',
    labelKey: 'skill.colorBlue',
    swatchClassName: 'bg-blue-500',
    initialsClassName: 'bg-blue-500 text-white',
  },
  {
    value: 'purple',
    labelKey: 'skill.colorPurple',
    swatchClassName: 'bg-purple-500',
    initialsClassName: 'bg-purple-500 text-white',
  },
]

interface SkillCardProps {
  skill: SharedSkill
  updatingColor: boolean
  onView: (slug: string) => void
  onInstall: (skill: SharedSkill) => void
  onViewInstalledAgents: (skill: SharedSkill) => void
  onColorChange: (skill: SharedSkill, color: SkillColor) => void
}

export function SkillCard({
  skill,
  updatingColor,
  onView,
  onInstall,
  onViewInstalledAgents,
  onColorChange,
}: SkillCardProps) {
  const { t } = useTranslation()
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const skillInitials = Array.from(skill.name.trim().normalize('NFKC'))
    .filter((character) => /[\p{L}\p{N}]/u.test(character))
    .slice(0, 3)
    .join('') || 'SK'
  const colorOption = SKILL_COLOR_OPTIONS.find((option) => option.value === skill.color)
    ?? SKILL_COLOR_OPTIONS.find((option) => option.value === 'blue')!
  const sourceLabel = skill.source === 'user-created'
    ? t('skill.sourceUserCreated')
    : skill.source.startsWith('external:')
      ? t('skill.sourceExternalImported')
      : t('skill.sourceExternal')

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (colorPickerOpen) {
          setColorPickerOpen(false)
          return
        }
        onView(skill.slug)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onView(skill.slug)
        }
      }}
      className="group relative flex h-[180px] w-full cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl bg-card p-5 shadow-sm transition-all duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex items-start gap-3">
        <Popover modal open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(event) => event.stopPropagation()}
              disabled={updatingColor}
              className={cn(
                'flex size-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold shadow-sm transition-transform hover:scale-105',
                colorOption.initialsClassName,
              )}
              title={t('skill.colorLabel')}
            >
              {updatingColor ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                skillInitials
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto p-2"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">
              {t('skill.colorLabel')}
            </div>
            <div className="flex items-center gap-1">
              {SKILL_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onColorChange(skill, option.value)
                    setColorPickerOpen(false)
                  }}
                  className="flex size-8 items-center justify-center rounded-md hover:bg-accent"
                  title={t(option.labelKey)}
                >
                  <span className={cn(
                    'flex size-5 items-center justify-center rounded-full text-white',
                    option.swatchClassName,
                  )}>
                    {skill.color === option.value && <Check className="size-3.5" />}
                  </span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <div className="min-w-0 flex-1 pr-2">
          <div className="truncate text-[15px] font-semibold text-foreground">
            {skill.name}
          </div>
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {skill.slug}
          </div>
        </div>
      </div>

      <p
        className={cn(
          'line-clamp-2 min-h-[2.5rem] text-sm',
          skill.description ? 'text-muted-foreground' : 'text-muted-foreground/50',
        )}
      >
        {skill.description || t('skill.noDescription')}
      </p>

      <div className="mt-auto flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate rounded-md bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
          {sourceLabel}
        </span>

        {skill.installedAgents.length > 0 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onViewInstalledAgents(skill)
            }}
            className="shrink-0 rounded-md bg-blue-500/10 px-2.5 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-500/15 dark:text-blue-400"
          >
            {skill.installedAgents.length} {t('skill.agentCount')}
          </button>
        ) : (
          <span className="shrink-0 rounded-md bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
            0 {t('skill.agentCount')}
          </span>
        )}

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onInstall(skill)
          }}
          className="ml-auto inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md bg-white px-2.5 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-black/5 transition-colors hover:bg-gray-50"
        >
          <Download className="size-3.5" />
          {t('skill.install')}
        </button>
      </div>
    </div>
  )
}
