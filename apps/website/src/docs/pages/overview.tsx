import { Callout, DocCard, DocList, DocTable, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function OverviewPage() {
  const { t } = useLanguage()

  return (
    <>
      <ManualHeader
        eyebrow={t('overview.eyebrow')}
        title={t('overview.title')}
        intro={t('overview.intro')}
      />

      <div className="docs-summary-grid">
        <div>
          <strong>{t('overview.multiModel')}</strong>
          <span>{t('overview.multiModelDesc')}</span>
        </div>
        <div>
          <strong>{t('overview.multiAgent')}</strong>
          <span>{t('overview.multiAgentDesc')}</span>
        </div>
        <div>
          <strong>{t('overview.automation')}</strong>
          <span>{t('overview.automationDesc')}</span>
        </div>
      </div>

      <div className="docs-grid docs-grid-2">
        <DocCard title={t('overview.howItWorksTitle')} eyebrow="How it works">
          <DocList
            items={[
              t('overview.howItWorks1'),
              t('overview.howItWorks2'),
              t('overview.howItWorks3'),
            ]}
          />
        </DocCard>
        <DocCard title={t('overview.bestForTitle')} eyebrow="Best for">
          <DocList
            items={[
              t('overview.bestFor1'),
              t('overview.bestFor2'),
              t('overview.bestFor3'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('overview.entryTitle')}</h2>
      <DocTable
        headers={[t('overview.entryFunc'), t('overview.entryUi'), t('overview.entryPurpose')]}
        rows={[
          [t('overview.entry1Func'), t('overview.entry1Ui'), t('overview.entry1Purpose')],
          [t('overview.entry2Func'), t('overview.entry2Ui'), t('overview.entry2Purpose')],
          [t('overview.entry3Func'), t('overview.entry3Ui'), t('overview.entry3Purpose')],
          [t('overview.entry4Func'), t('overview.entry4Ui'), t('overview.entry4Purpose')],
          [t('overview.entry5Func'), t('overview.entry5Ui'), t('overview.entry5Purpose')],
          [t('overview.entry6Func'), t('overview.entry6Ui'), t('overview.entry6Purpose')],
          [t('overview.entry7Func'), t('overview.entry7Ui'), t('overview.entry7Purpose')],
        ]}
      />

      <h2 className="docs-article-h2">{t('overview.conceptTitle')}</h2>
      <DocCard title={t('overview.conceptCardTitle')} eyebrow="Concepts">
        <DocList
          items={[
            <><strong>{t('overview.concept1')}</strong>{t('overview.concept1Desc')}</>,
            <><strong>{t('overview.concept2')}</strong>{t('overview.concept2Desc')}</>,
            <><strong>{t('overview.concept3')}</strong>{t('overview.concept3Desc')}</>,
            <><strong>{t('overview.concept4')}</strong>{t('overview.concept4Desc')}</>,
            <><strong>{t('overview.concept5')}</strong>{t('overview.concept5Desc')}</>,
            <><strong>{t('overview.concept6')}</strong>{t('overview.concept6Desc')}</>,
            <><strong>{t('overview.concept7')}</strong>{t('overview.concept7Desc')}</>,
          ]}
        />
      </DocCard>

      <Callout title={t('overview.suggestTitle')}>
        {t('overview.suggestDesc')}
      </Callout>
    </>
  )
}