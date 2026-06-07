import { Callout, DocCard, DocList, DocTimeline, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function WebAccessPage() {
  const { t } = useLanguage()
  return (
    <>
      <ManualHeader
        eyebrow={t('webAccess.eyebrow')}
        title={t('webAccess.title')}
        intro={t('webAccess.intro')}
      />

      <h2 className="docs-article-h2">{t('webAccess.whatIsIt')}</h2>
      <p className="docs-article-p">{t('webAccess.whatIsItDesc')}</p>

      <div className="docs-grid docs-grid-2">
        <DocCard title={t('webAccess.whenTitle')} eyebrow="When">
          <DocList
            items={[
              t('webAccess.when1'),
              t('webAccess.when2'),
              t('webAccess.when3'),
            ]}
          />
        </DocCard>
        <DocCard title={t('webAccess.featuresTitle')} eyebrow="Features">
          <DocList
            items={[
              t('webAccess.features1'),
              t('webAccess.features2'),
              t('webAccess.features3'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('webAccess.howToOpen')}</h2>
      <DocTimeline
        steps={[
          { title: t('webAccess.step1Title'), desc: t('webAccess.step1Desc') },
          { title: t('webAccess.step2Title'), desc: t('webAccess.step2Desc') },
          { title: t('webAccess.step3Title'), desc: t('webAccess.step3Desc') },
          { title: t('webAccess.step4Title'), desc: t('webAccess.step4Desc') },
        ]}
      />

      <Callout title={t('webAccess.diffTitle')}>{t('webAccess.diffDesc')}</Callout>
      <Callout title={t('webAccess.tipTitle')}>{t('webAccess.tipDesc')}</Callout>
    </>
  )
}
