import { Callout, DocCard, DocList, DocTimeline, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function MobilePage() {
  const { t } = useLanguage()
  return (
    <>
      <ManualHeader
        eyebrow={t('mobile.eyebrow')}
        title={t('mobile.title')}
        intro={t('mobile.intro')}
      />

      <h2 className="docs-article-h2">{t('mobile.whatIsIt')}</h2>
      <p className="docs-article-p">{t('mobile.whatIsItDesc')}</p>

      <div className="docs-grid docs-grid-2">
        <DocCard title={t('mobile.whenTitle')} eyebrow="When">
          <DocList
            items={[
              t('mobile.when1'),
              t('mobile.when2'),
              t('mobile.when3'),
            ]}
          />
        </DocCard>
        <DocCard title={t('mobile.featuresTitle')} eyebrow="Features">
          <DocList
            items={[
              t('mobile.features1'),
              t('mobile.features2'),
              t('mobile.features3'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('mobile.connectTitle')}</h2>
      <p className="docs-article-p">{t('mobile.connectDesc')}</p>
      <DocTimeline
        steps={[
          { title: t('mobile.step1Title'), desc: t('mobile.step1Desc') },
          { title: t('mobile.step2Title'), desc: t('mobile.step2Desc') },
          { title: t('mobile.step3Title'), desc: t('mobile.step3Desc') },
          { title: t('mobile.step4Title'), desc: t('mobile.step4Desc') },
        ]}
      />

      <Callout title={t('mobile.troubleTitle')}>{t('mobile.troubleDesc')}</Callout>
      <Callout title={t('mobile.tipTitle')}>{t('mobile.tipDesc')}</Callout>
    </>
  )
}
