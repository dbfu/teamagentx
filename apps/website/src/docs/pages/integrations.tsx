import { Callout, CodeBlock, DocCard, DocList, DocTimeline, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function IntegrationsPage() {
  const { t } = useLanguage()

  return (
    <>
      <ManualHeader
        eyebrow={t('integrations.eyebrow')}
        title={t('integrations.title')}
        intro={t('integrations.intro')}
      />

      <h2 className="docs-article-h2">{t('integrations.conceptsTitle')}</h2>
      <DocCard title={t('integrations.conceptsCardTitle')} eyebrow="Key concepts">
        <DocList
          items={[
            <><strong>{t('integrations.conceptsItem1Prefix')}</strong>{t('integrations.conceptsItem1Desc')}</>,
            <><strong>{t('integrations.conceptsItem2Prefix')}</strong>{t('integrations.conceptsItem2Desc')}</>,
            <><strong>{t('integrations.conceptsItem3Prefix')}</strong>{t('integrations.conceptsItem3Desc')}</>,
            <><strong>{t('integrations.conceptsItem4Prefix')}</strong>{t('integrations.conceptsItem4Desc')}</>,
          ]}
        />
      </DocCard>

      <h2 className="docs-article-h2">{t('integrations.entryTitle')}</h2>
      <p className="docs-article-p">{t('integrations.entryDesc')}</p>

      <h2 className="docs-article-h2">{t('integrations.publicAddrTitle')}</h2>
      <p className="docs-article-p">{t('integrations.publicAddrDesc')}</p>
      <CodeBlock>{`https://your-domain.com`}</CodeBlock>
      <p className="docs-article-p">{t('integrations.publicAddrTip')}</p>

      <h2 className="docs-article-h2">{t('integrations.createBotTitle')}</h2>
      <DocTimeline
        steps={[
          { title: t('integrations.step1Title'), desc: t('integrations.step1Desc') },
          { title: t('integrations.step2Title'), desc: t('integrations.step2Desc') },
          { title: t('integrations.step3Title'), desc: t('integrations.step3Desc') },
          { title: t('integrations.step4Title'), desc: t('integrations.step4Desc') },
          { title: t('integrations.step5Title'), desc: t('integrations.step5Desc') },
          { title: t('integrations.step6Title'), desc: t('integrations.step6Desc') },
        ]}
      />

      <h2 className="docs-article-h2">{t('integrations.bindTitle')}</h2>
      <DocCard title={t('integrations.bindCardTitle')} eyebrow="Binding">
        <DocList
          items={[
            t('integrations.bindItem1'),
            t('integrations.bindItem2'),
            t('integrations.bindItem3'),
            t('integrations.bindItem4'),
          ]}
        />
      </DocCard>

      <h2 className="docs-article-h2">{t('integrations.webhookTitle')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('integrations.webhookCardTitle')} eyebrow="Webhook">
          <DocList
            items={[
              t('integrations.webhookItem1'),
              t('integrations.webhookItem2'),
            ]}
          />
        </DocCard>
        <DocCard title={t('integrations.eventsCardTitle')} eyebrow="Events">
          <DocList
            items={[
              t('integrations.eventsItem1'),
              t('integrations.eventsItem2'),
              t('integrations.eventsItem3'),
            ]}
          />
        </DocCard>
      </div>
      <p className="docs-article-p">{t('integrations.feishuNote')}</p>

      <Callout title={t('integrations.tipTitle')}>
        {t('integrations.tipDesc')}
      </Callout>
    </>
  )
}