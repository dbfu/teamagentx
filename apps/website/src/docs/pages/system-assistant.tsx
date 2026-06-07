import { Callout, CodeBlock, DocCard, DocList, DocTable, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function SystemAssistantPage() {
  const { t } = useLanguage()

  return (
    <>
      <ManualHeader
        eyebrow={t('sysAssistant.eyebrow')}
        title={t('sysAssistant.title')}
        intro={t('sysAssistant.intro')}
      />

      <h2 className="docs-article-h2">{t('sysAssistant.whatIsIt')}</h2>
      <p className="docs-article-p">
        {t('sysAssistant.whatIsItDesc')}
      </p>
      <Callout title={t('sysAssistant.calloutTitle')}>
        {t('sysAssistant.calloutDesc')}
      </Callout>

      <h2 className="docs-article-h2">{t('sysAssistant.modulesTitle')}</h2>
      <DocTable
        headers={[t('sysAssistant.moduleHeader1'), t('sysAssistant.moduleHeader2'), t('sysAssistant.moduleHeader3')]}
        rows={[
          [t('sysAssistant.moduleAgentMgmt'), t('sysAssistant.moduleAgentMgmtDesc'), t('sysAssistant.moduleAgentMgmtExample')],
          [t('sysAssistant.moduleSkillMgmt'), t('sysAssistant.moduleSkillMgmtDesc'), t('sysAssistant.moduleSkillMgmtExample')],
          [t('sysAssistant.moduleCronTasks'), t('sysAssistant.moduleCronTasksDesc'), t('sysAssistant.moduleCronTasksExample')],
          [t('sysAssistant.moduleRoomMgmt'), t('sysAssistant.moduleRoomMgmtDesc'), t('sysAssistant.moduleRoomMgmtExample')],
          [t('sysAssistant.moduleExtPlatform'), t('sysAssistant.moduleExtPlatformDesc'), t('sysAssistant.moduleExtPlatformExample')],
        ]}
      />

      <h2 className="docs-article-h2">{t('sysAssistant.howToUse')}</h2>
      <DocCard title={t('sysAssistant.cardHowToTitle')} eyebrow="How to use">
        <DocList
          items={[
            <>{t('sysAssistant.cardHowToItem1')}</>,
            t('sysAssistant.cardHowToItem2'),
            t('sysAssistant.cardHowToItem3'),
            t('sysAssistant.cardHowToItem4'),
          ]}
        />
      </DocCard>
      <CodeBlock>{`@群助手 帮我创建一个"竞品调研"助手，用 Claude，
擅长搜索和整理行业数据，输出结构化的对比表。`}</CodeBlock>

      <h2 className="docs-article-h2">{t('sysAssistant.confirmTitle')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('sysAssistant.confirmCardTitle')} eyebrow="Confirmation">
          <DocList
            items={[
              t('sysAssistant.confirmCardItem1'),
              t('sysAssistant.confirmCardItem2'),
              t('sysAssistant.confirmCardItem3'),
            ]}
          />
        </DocCard>
        <DocCard title={t('sysAssistant.skillsCardTitle')} eyebrow="Skills">
          <DocList
            items={[
              t('sysAssistant.skillsCardItem1'),
              t('sysAssistant.skillsCardItem2'),
              t('sysAssistant.skillsCardItem3'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('sysAssistant.diffTitle')}</h2>
      <p className="docs-article-p">
        {t('sysAssistant.diffDesc')}
      </p>

      <Callout title={t('sysAssistant.tipTitle')}>
        {t('sysAssistant.tipDesc')}
      </Callout>
    </>
  )
}