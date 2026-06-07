import { Callout, Code, CodeBlock, DocCard, DocList, DocTable, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function CronTasksPage() {
  const { t } = useLanguage()

  return (
    <>
      <ManualHeader
        eyebrow={t('cronTasks.eyebrow')}
        title={t('cronTasks.title')}
        intro={t('cronTasks.intro')}
      />

      <h2 className="docs-article-h2">{t('cronTasks.entryTitle')}</h2>
      <p className="docs-article-p">{t('cronTasks.entryDesc')}</p>

      <h2 className="docs-article-h2">{t('cronTasks.createTitle')}</h2>
      <DocCard title={t('cronTasks.createCardTitle')} eyebrow="Create">
        <DocList
          items={[
            <><strong>{t('cronTasks.fieldName')}</strong>{t('cronTasks.fieldNameDesc')}</>,
            <><strong>{t('cronTasks.fieldDesc')}</strong>{t('cronTasks.fieldDescDesc')}</>,
            <><strong>{t('cronTasks.fieldScheduleType')}</strong>{t('cronTasks.fieldScheduleTypeDesc')}</>,
            <><strong>{t('cronTasks.fieldContent')}</strong>{t('cronTasks.fieldContentDesc')}</>,
            <><strong>{t('cronTasks.fieldAgent')}</strong>{t('cronTasks.fieldAgentDesc')}</>,
            <><strong>{t('cronTasks.fieldRetry')}</strong>{t('cronTasks.fieldRetryDesc')}</>,
            <><strong>{t('cronTasks.fieldEnable')}</strong>{t('cronTasks.fieldEnableDesc')}</>,
          ]}
        />
        <p className="docs-card-note">{t('cronTasks.contentNote')}</p>
      </DocCard>

      <h2 className="docs-article-h2">{t('cronTasks.scheduleTypeTitle')}</h2>
      <p className="docs-article-p">{t('cronTasks.cronFormatDesc')}</p>
      <CodeBlock>{`Minute Hour Day Month Week`}</CodeBlock>
      <DocTable
        headers={[t('cronTasks.tableHeader1'), t('cronTasks.tableHeader2')]}
        rows={[
          [t('cronTasks.presetHourly'), <Code>0 * * * *</Code>],
          [t('cronTasks.presetDaily9'), <Code>0 9 * * *</Code>],
          [t('cronTasks.presetDaily18'), <Code>0 18 * * *</Code>],
          [t('cronTasks.presetMonday9'), <Code>0 9 * * 1</Code>],
          [t('cronTasks.presetFriday18'), <Code>0 18 * * 5</Code>],
          [t('cronTasks.presetMonthly'), <Code>0 9 1 * *</Code>],
        ]}
      />
      <p className="docs-article-p">{t('cronTasks.intervalDesc')}</p>

      <h2 className="docs-article-h2">{t('cronTasks.triggerTitle')}</h2>
      <DocCard title={t('cronTasks.triggerCardTitle')} eyebrow="Trigger">
        <DocList
          items={[
            t('cronTasks.triggerItem1'),
            t('cronTasks.triggerItem2'),
            t('cronTasks.triggerItem3'),
          ]}
        />
      </DocCard>

      <h2 className="docs-article-h2">{t('cronTasks.historyTitle')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('cronTasks.cardCardTitle')} eyebrow="Card">
          <DocList
            items={[
              t('cronTasks.cardItem1'),
              t('cronTasks.cardItem2'),
            ]}
          />
        </DocCard>
        <DocCard title={t('cronTasks.historyCardTitle')} eyebrow="History">
          <DocList
            items={[
              t('cronTasks.historyItem1'),
              t('cronTasks.historyItem2'),
              t('cronTasks.historyItem3'),
            ]}
          />
        </DocCard>
      </div>

      <Callout title={t('cronTasks.tipTitle')}>
        {t('cronTasks.tipDesc')}
      </Callout>
    </>
  )
}