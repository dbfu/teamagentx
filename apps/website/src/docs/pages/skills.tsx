import { Callout, Code, CodeBlock, DocCard, DocList, DocTable, DocTimeline, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function SkillsPage() {
  const { t } = useLanguage()

  return (
    <>
      <ManualHeader
        eyebrow={t('skills.eyebrow')}
        title={t('skills.title')}
        intro={t('skills.intro')}
      />

      <h2 className="docs-article-h2">{t('skills.entryTitle')}</h2>
      <p className="docs-article-p">{t('skills.entryDesc')}</p>

      <h2 className="docs-article-h2">{t('skills.listTitle')}</h2>
      <DocCard title={t('skills.listShowTitle')} eyebrow="Shared skills">
        <DocList
          items={[
            t('skills.listShow1'),
            t('skills.listShow2'),
            t('skills.listShow3'),
            <>{t('skills.listShow4')} <Code>SKILL.md</Code></>,
          ]}
        />
      </DocCard>

      <h2 className="docs-article-h2">{t('skills.installTitle')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('skills.installToTitle')} eyebrow="Install">
          <DocList
            items={[
              t('skills.installTo1'),
              t('skills.installTo2'),
            ]}
          />
        </DocCard>
        <DocCard title={t('skills.removeTitle')} eyebrow="Remove">
          <DocList
            items={[
              t('skills.remove1'),
              t('skills.remove2'),
              t('skills.remove3'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('skills.importTitle')}</h2>
      <p className="docs-article-p">{t('skills.importDesc')}</p>

      <h3 className="docs-article-h3">{t('skills.sourceTitle')}</h3>
      <p className="docs-article-p">{t('skills.sourceDesc')}</p>
      <DocTable
        headers={[t('skills.sourceTool'), t('skills.sourceDesc2')]}
        rows={[
          [<Code>Claude Code</Code>, t('skills.sourceClaude')],
          [<Code>Codex</Code>, t('skills.sourceCodex')],
          [<Code>OpenClaw</Code>, t('skills.sourceOpenClaw')],
          [<Code>Agent</Code>, t('skills.sourceAgent')],
          [t('skills.sourceLocal'), t('skills.sourceLocalDesc')],
        ]}
      />

      <h3 className="docs-article-h3">{t('skills.flowTitle')}</h3>
      <DocTimeline
        steps={[
          { title: t('skills.flow1Title'), desc: <>{t('skills.flow1Desc')}</> },
          { title: t('skills.flow2Title'), desc: t('skills.flow2Desc') },
          { title: t('skills.flow3Title'), desc: t('skills.flow3Desc') },
          { title: t('skills.flow4Title'), desc: t('skills.flow4Desc') },
        ]}
      />

      <h3 className="docs-article-h3">{t('skills.compareTitle')}</h3>
      <DocTable
        headers={[t('skills.compareItem'), t('skills.compareSymlink'), t('skills.compareCopy')]}
        rows={[
          [t('skills.compare1Item'), t('skills.compare1Symlink'), t('skills.compare1Copy')],
          [t('skills.compare2Item'), t('skills.compare2Symlink'), t('skills.compare2Copy')],
          [t('skills.compare3Item'), t('skills.compare3Symlink'), t('skills.compare3Copy')],
          [t('skills.compare4Item'), t('skills.compare4Symlink'), t('skills.compare4Copy')],
          [t('skills.compare5Item'), <>{t('skills.compare5Symlink')}</>, t('skills.compare5Copy')],
        ]}
      />

      <h3 className="docs-article-h3">{t('skills.localFolderTitle')}</h3>
      <DocCard title={t('skills.localFolderCard')} eyebrow="Local folder">
        <DocList
          items={[
            t('skills.localFolder1'),
            <>{t('skills.localFolder2')} <Code>SKILL.md</Code>，{t('skills.localFolder3')}</>,
            t('skills.localFolder4'),
            t('skills.localFolder5'),
          ]}
        />
      </DocCard>

      <Callout title={t('skills.importTipTitle')}>
        {t('skills.importTipDesc')}
      </Callout>

      <h2 className="docs-article-h2">{t('skills.createTitle')}</h2>
      <p className="docs-article-p">{t('skills.createDesc')}</p>
      <CodeBlock>{t('skills.createCode')}</CodeBlock>
      <p className="docs-article-p">{t('skills.createAfter')}</p>

      <Callout title={t('skills.suggestTitle')}>
        {t('skills.suggestDesc')}
      </Callout>
    </>
  )
}