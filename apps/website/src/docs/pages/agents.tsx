import { Callout, Code, DocCard, DocList, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function AgentsPage() {
  const { t } = useLanguage()

  return (
    <>
      <ManualHeader
        eyebrow={t('agents.eyebrow')}
        title={t('agents.title')}
        intro={t('agents.intro')}
      />

      <h2 className="docs-article-h2">{t('agents.entryTitle')}</h2>
      <p className="docs-article-p">{t('agents.entryDesc')}</p>

      <h2 className="docs-article-h2">{t('agents.createTitle')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('agents.basicTitle')} eyebrow="Basics">
          <DocList
            items={[
              <><strong>{t('agents.basicName')}</strong></>,
              <><strong>{t('agents.basicAvatar')}</strong></>,
              <><strong>{t('agents.basicDesc')}</strong></>,
              <><strong>{t('agents.basicCategory')}</strong></>,
            ]}
          />
        </DocCard>
        <DocCard title={t('agents.runtimeTitle')} eyebrow="Runtime">
          <DocList
            items={[
              t('agents.runtimeAgent'),
              t('agents.runtimeNotInstalled'),
              t('agents.runtimeProvider'),
              t('agents.runtimeLocal'),
            ]}
          />
        </DocCard>
      </div>

      <div className="docs-grid docs-grid-2">
        <DocCard title={t('agents.thinkingTitle')} eyebrow="Thinking">
          <DocList
            items={[
              t('agents.thinking1'),
              t('agents.thinking2'),
              t('agents.thinking3'),
            ]}
          />
        </DocCard>
        <DocCard title={t('agents.localProxyTitle')} eyebrow="Local & proxy">
          <DocList
            items={[
              t('agents.localProxy1'),
              <>{t('agents.localProxy2')} <Code>http://127.0.0.1:7890</Code></>,
              t('agents.localProxy3'),
            ]}
          />
        </DocCard>
      </div>

      <Callout title={t('agents.imageGenTitle')}>
        {t('agents.imageGenDesc')}
      </Callout>

      <h2 className="docs-article-h2">{t('agents.promptTitle')}</h2>
      <DocCard title={t('agents.promptSuggest')} eyebrow="Prompting">
        <DocList
          items={[
            t('agents.prompt1'),
            t('agents.prompt2'),
            t('agents.prompt3'),
            t('agents.prompt4'),
            t('agents.prompt5'),
          ]}
        />
        <p className="docs-card-note">{t('agents.promptNote')}</p>
      </DocCard>

      <h2 className="docs-article-h2">{t('agents.detailTitle')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('agents.detailConfigTitle')} eyebrow="Detail">
          <DocList
            items={[
              t('agents.detailConfig1'),
              t('agents.detailConfig2'),
            ]}
          />
        </DocCard>
        <DocCard title={t('agents.detailTabsTitle')} eyebrow="Tabs">
          <DocList
            items={[
              t('agents.detailTabs1'),
              t('agents.detailTabs2'),
              t('agents.detailTabs3'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('agents.diaryTitle')}</h2>
      <p className="docs-article-p">{t('agents.diaryIntro')}</p>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('agents.diaryHowTitle')} eyebrow="Diary">
          <DocList
            items={[
              t('agents.diaryHow1'),
              t('agents.diaryHow2'),
              t('agents.diaryHow3'),
              t('agents.diaryHow4'),
            ]}
          />
        </DocCard>
        <DocCard title={t('agents.diaryMemoryTitle')} eyebrow="Memory">
          <p className="docs-card-note">{t('agents.diaryMemoryDesc')}</p>
        </DocCard>
      </div>
      <Callout title={t('agents.diaryTitle')}>
        {t('agents.diaryTip')}
      </Callout>

      <h2 className="docs-article-h2">{t('agents.enableTitle')}</h2>
      <p className="docs-article-p">{t('agents.enableDesc')}</p>

      <Callout title={t('agents.suggestTitle')}>
        {t('agents.suggestDesc')}
      </Callout>
    </>
  )
}