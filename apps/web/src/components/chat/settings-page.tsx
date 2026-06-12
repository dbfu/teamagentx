import { cn } from '@/lib/utils';
import { HelpCircle, Settings, SlidersHorizontal, Smartphone, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccountSection } from './settings/account-section';
import { AboutSection } from './settings/about-section';
import { GeneralSection } from './settings/general-section';
import { SoftwareSection } from './settings/software-section';

type SettingsSection = 'account' | 'general' | 'software' | 'about'

interface SettingsPageProps {
  isMobile?: boolean
}

export function SettingsPage({ isMobile }: SettingsPageProps) {
  const { t } = useTranslation()
  const [section, setSection] = useState<SettingsSection>('account')

  const navItems: Array<{ id: SettingsSection; label: string; icon: LucideIcon }> = [
    { id: 'account', label: t('settings.navAccount'), icon: User },
    { id: 'general', label: t('settings.navGeneral'), icon: SlidersHorizontal },
    { id: 'software', label: t('settings.navSoftware'), icon: Smartphone },
    { id: 'about', label: t('settings.navAbout'), icon: HelpCircle },
  ]

  const renderSection = () => {
    switch (section) {
      case 'account':
        return <AccountSection />
      case 'general':
        return <GeneralSection />
      case 'software':
        return <SoftwareSection />
      case 'about':
        return <AboutSection />
    }
  }

  // 移动端：顶部横向导航 + 内容
  if (isMobile) {
    return (
      <div className="flex flex-1 flex-col bg-background">
        <div
          className="flex items-center gap-2 overflow-x-auto border-b border-border px-4 py-2"
          style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
        >
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = item.id === section
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            )
          })}
        </div>
        <div className="flex-1 overflow-y-auto p-4 pb-20">
          {renderSection()}
        </div>
      </div>
    )
  }

  // 桌面端：顶部横向 Header（支持拖拽）+ 左侧纵向导航 + 右侧内容
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* 顶部 Header - 横跨全宽，支持拖拽 */}
      <div
        className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-6"
        style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
      >
        <Settings className="size-4 text-primary" />
        <h2 className="text-base font-semibold text-foreground">{t('settings.pageTitle')}</h2>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧导航 */}
        <aside
          className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar/40 p-3"
          style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
        >
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = item.id === section
              return (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-accent text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50'
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* 右侧内容 */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderSection()}
        </div>
      </div>
    </div>
  )
}
