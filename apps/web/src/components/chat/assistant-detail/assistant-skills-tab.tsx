import { useState } from 'react'
import { Download, Eye, Package, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { InstalledSkill } from '@/lib/skill-api'
import { InstallSkillModal } from '../install-skill-modal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SkillDetailModal } from '../skill-detail-modal'

interface AssistantSkillsTabProps {
  agentId: string
  agentName: string
  skills: InstalledSkill[]
  onUninstall: (slug: string) => Promise<void>
  onRefresh?: () => void  // 刷新技能列表回调
}

export function AssistantSkillsTab({
  agentId,
  agentName,
  skills,
  onUninstall,
  onRefresh,
}: AssistantSkillsTabProps) {
  const { t } = useTranslation()
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false)
  const [uninstallingSlug, setUninstallingSlug] = useState<string | null>(null)
  const [viewingSkillSlug, setViewingSkillSlug] = useState<string | null>(null)

  const handleUninstall = async (slug: string) => {
    setUninstallingSlug(slug)
    await onUninstall(slug)
    setUninstallingSlug(null)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t('assistant.installedSkillsTitle')}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('assistant.skillsDesc')}
          </p>
        </div>
        <Button
          onClick={() => setIsInstallModalOpen(true)}
          className="gap-2 bg-primary hover:bg-primary/90 text-white"
        >
          <Download className="size-4" />
          {t('assistant.installNewSkill')}
        </Button>
      </div>

      {/* Skills List */}
      {skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-muted/50 rounded-2xl border border-border">
          <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Package className="size-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">{t('assistant.noInstalledSkills')}</h3>
          <p className="text-sm text-muted-foreground mb-6">{t('assistant.noInstalledSkillsHint')}</p>
          <Button
            variant="outline"
            onClick={() => setIsInstallModalOpen(true)}
            className="gap-2"
          >
            <Download className="size-4" />
            {t('assistant.installFirstSkill')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {skills.map((skill) => (
            <div
              key={skill.slug}
              role="button"
              tabIndex={0}
              onClick={() => setViewingSkillSlug(skill.slug)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setViewingSkillSlug(skill.slug)
                }
              }}
              className="group relative flex cursor-pointer items-center justify-between rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:border-primary/20 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {/* Skill 信息 */}
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-lg bg-primary/5 flex items-center justify-center">
                  <Package className="size-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-medium text-foreground">{skill.slug}</h4>
                  {skill.version && (
                    <Badge variant="outline" className="mt-1 text-xs bg-muted">
                      v{skill.version}
                    </Badge>
                  )}
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    setViewingSkillSlug(skill.slug)
                  }}
                  className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  title={t('common.view')}
                >
                  <Eye className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    handleUninstall(skill.slug)
                  }}
                  disabled={uninstallingSlug === skill.slug}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t('common.delete')}
                >
                  {uninstallingSlug === skill.slug ? (
                    <div className="size-4 animate-spin rounded-full border-2 border-muted border-t-destructive" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Install Modal */}
      {isInstallModalOpen && (
        <InstallSkillModal
          isOpen={isInstallModalOpen}
          onClose={() => setIsInstallModalOpen(false)}
          onSuccess={() => {
            setIsInstallModalOpen(false)
            onRefresh?.()
          }}
          agentId={agentId}
          agentName={agentName}
        />
      )}

      <SkillDetailModal
        slug={viewingSkillSlug}
        onClose={() => setViewingSkillSlug(null)}
      />
    </div>
  )
}
