import { Callout, DocCard, DocList, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function QuickChatPage() {
  const { t } = useLanguage()
  return (
    <>
      <ManualHeader
        eyebrow={t('quickChat.eyebrow')}
        title={t('quickChat.title')}
        intro={t('quickChat.intro')}
      />

      <h2 className="docs-article-h2">{t('quickChat.howToStart')}</h2>
      <p className="docs-article-p">{t('quickChat.howToStartDesc')}</p>

      <h2 className="docs-article-h2">{t('quickChat.workDir')}</h2>
      <DocCard title={t('quickChat.workDirTitle')} eyebrow="Work dir">
        <DocList
          items={[
            t('quickChat.workDir1'),
            t('quickChat.workDir2'),
            t('quickChat.workDir3'),
            t('quickChat.workDir4'),
          ]}
        />
      </DocCard>

      <h2 className="docs-article-h2">{t('quickChat.behavior')}</h2>
      <DocCard title={t('quickChat.diffTitle')} eyebrow="Behavior">
        <DocList
          items={[
            t('quickChat.diff1'),
            t('quickChat.diff2'),
            t('quickChat.diff3'),
            t('quickChat.diff4'),
          ]}
        />
      </DocCard>

      <h2 className="docs-article-h2">{t('quickChat.history')}</h2>
      <p className="docs-article-p">{t('quickChat.historyDesc')}</p>

      <div className="docs-grid docs-grid-2">
        <DocCard title={t('quickChat.goodForTitle')} eyebrow="Good for">
          <DocList
            items={[
              t('quickChat.goodFor1'),
              t('quickChat.goodFor2'),
              t('quickChat.goodFor3'),
              t('quickChat.goodFor4'),
            ]}
          />
        </DocCard>
        <DocCard title={t('quickChat.useRoomTitle')} eyebrow="Use a room instead">
          <DocList
            items={[
              t('quickChat.useRoom1'),
              t('quickChat.useRoom2'),
              t('quickChat.useRoom3'),
              t('quickChat.useRoom4'),
            ]}
          />
        </DocCard>
      </div>

      <Callout title={t('quickChat.summaryTitle')}>{t('quickChat.summaryDesc')}</Callout>
    </>
  )
}