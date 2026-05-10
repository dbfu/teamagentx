import { useState } from 'react'
import { Download, Package, Trash2 } from 'lucide-react'
import { InstalledSkill } from '@/lib/skill-api'
import { InstallSkillModal } from '../install-skill-modal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

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
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false)
  const [uninstallingSlug, setUninstallingSlug] = useState<string | null>(null)

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
          <h2 className="text-xl font-semibold text-foreground">已安装 Skills</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Skills 可以扩展助手的能力，让它执行更多任务
          </p>
        </div>
        <Button
          onClick={() => setIsInstallModalOpen(true)}
          className="gap-2 bg-primary hover:bg-primary/90 text-white"
        >
          <Download className="size-4" />
          安装新 Skill
        </Button>
      </div>

      {/* Skills List */}
      {skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-muted/50 rounded-2xl border border-border">
          <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Package className="size-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">暂无已安装的 Skills</h3>
          <p className="text-sm text-muted-foreground mb-6">安装 Skills 来扩展助手的能力</p>
          <Button
            variant="outline"
            onClick={() => setIsInstallModalOpen(true)}
            className="gap-2"
          >
            <Download className="size-4" />
            安装第一个 Skill
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {skills.map((skill) => (
            <div
              key={skill.slug}
              className="group relative bg-card rounded-xl border border-border p-5 hover:border-primary/20 hover:shadow-lg transition-all duration-200 flex items-center justify-between"
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleUninstall(skill.slug)}
                disabled={uninstallingSlug === skill.slug}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {uninstallingSlug === skill.slug ? (
                  <div className="size-4 animate-spin rounded-full border-2 border-muted border-t-destructive" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
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
    </div>
  )
}