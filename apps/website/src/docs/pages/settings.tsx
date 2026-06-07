import { Callout, DocCard, DocList, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function SettingsPage() {
  const { t } = useLanguage()
  return (
    <>
      <ManualHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        intro={t('settings.intro')}
      />

      <h2 className="docs-article-h2">{t('settings.pageEntry')}</h2>
      <p className="docs-article-p">{t('settings.pageEntryDesc')}</p>

      <h2 className="docs-article-h2">{t('settings.personalInfo')}</h2>
      <DocCard title={t('settings.profileModify')} eyebrow={t('settings.profileModifyEyebrow')}>
        <DocList
          items={[
            t('settings.profileItem1'),
            t('settings.profileItem2'),
            t('settings.profileItem3'),
          ]}
        />
      </DocCard>

      <h2 className="docs-article-h2">{t('settings.appearance')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('settings.themeColor')} eyebrow={t('settings.themeColorEyebrow')}>
          <DocList
            items={[
              t('settings.themeItem1'),
              t('settings.themeItem2'),
              t('settings.themeItem3'),
            ]}
          />
        </DocCard>
        <DocCard title={t('settings.gitBranch')} eyebrow={t('settings.gitBranchEyebrow')}>
          <DocList
            items={[
              t('settings.gitBranchItem1'),
              t('settings.gitBranchItem2'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('settings.notification')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('settings.messageSound')} eyebrow={t('settings.messageSoundEyebrow')}>
          <DocList items={[t('settings.messageSoundItem')]} />
        </DocCard>
        <DocCard title={t('settings.systemNotif')} eyebrow={t('settings.systemNotifEyebrow')}>
          <DocList
            items={[
              t('settings.systemNotifItem1'),
              t('settings.systemNotifItem2'),
              t('settings.systemNotifItem3'),
              t('settings.systemNotifItem4'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('settings.clientTerminal')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('settings.client')} eyebrow={t('settings.clientEyebrow')}>
          <DocList
            items={[
              t('settings.clientItem1'),
              t('settings.clientItem2'),
            ]}
          />
        </DocCard>
        <DocCard title={t('settings.terminal')} eyebrow={t('settings.terminalEyebrow')}>
          <DocList
            items={[
              t('settings.terminalItem1'),
              t('settings.terminalItem2'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('settings.aiToolRuntime')}</h2>
      <DocCard title={t('settings.runtimeDetection')} eyebrow={t('settings.runtimeDetectionEyebrow')}>
        <DocList
          items={[
            t('settings.runtimeItem1'),
            t('settings.runtimeItem2'),
            t('settings.runtimeItem3'),
            t('settings.runtimeItem4'),
          ]}
        />
      </DocCard>

      <h2 className="docs-article-h2">{t('settings.multiDevice')}</h2>
      <DocCard title={t('settings.mobileWeb')} eyebrow={t('settings.mobileWebEyebrow')}>
        <DocList
          items={[
            t('settings.mobileWebItem1'),
            t('settings.mobileWebItem2'),
          ]}
        />
        <p className="docs-card-note">{t('settings.mobileWebNote')}</p>
      </DocCard>

      <Callout title={t('settings.qrSecurityTitle')}>
        {t('settings.qrSecurityDesc')}
      </Callout>

      <h2 className="docs-article-h2">{t('settings.updateDocs')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('settings.clientUpdate')} eyebrow={t('settings.clientUpdateEyebrow')}>
          <DocList
            items={[
              t('settings.clientUpdateItem1'),
              t('settings.clientUpdateItem2'),
            ]}
          />
        </DocCard>
        <DocCard title={t('settings.officialDocs')} eyebrow={t('settings.officialDocsEyebrow')}>
          <DocList
            items={[
              t('settings.officialDocsItem1'),
              t('settings.officialDocsItem2'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('settings.logout')}</h2>
      <p className="docs-article-p">{t('settings.logoutDesc')}</p>

      <Callout title={t('settings.whenToVisitTitle')}>
        {t('settings.whenToVisitDesc')}
      </Callout>
    </>
  )
}