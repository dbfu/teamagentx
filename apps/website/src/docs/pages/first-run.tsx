import { Callout, CodeBlock, DocCard, DocList, DocTimeline, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function FirstRunPage() {
  const { t } = useLanguage()
  return (
    <>
      <ManualHeader
        eyebrow={t('firstRun.eyebrow')}
        title={t('firstRun.title')}
        intro={t('firstRun.intro')}
      />

      <h2 className="docs-article-h2">{t('firstRun.installClient')}</h2>
      <p className="docs-article-p">{t('firstRun.installDesc')}</p>

      <DocCard title={t('firstRun.macosAuth')} eyebrow={t('firstRun.macosAuthEyebrow')}>
        <DocList
          items={[
            t('firstRun.macosStep1'),
            t('firstRun.macosStep2'),
            t('firstRun.macosStep3'),
            t('firstRun.macosStep4'),
          ]}
        />
      </DocCard>

      <Callout title={t('firstRun.corruptedTitle')}>
        {t('firstRun.corruptedDesc')}
        <CodeBlock>{`sudo xattr -rd com.apple.quarantine /Applications/TeamAgentX.app`}</CodeBlock>
        {t('firstRun.corruptedNote')}
      </Callout>

      <h2 className="docs-article-h2">{t('firstRun.setupProcess')}</h2>
      <DocTimeline
        steps={[
          { title: t('firstRun.step1Title'), desc: t('firstRun.step1Desc') },
          { title: t('firstRun.step2Title'), desc: t('firstRun.step2Desc') },
          { title: t('firstRun.step3Title'), desc: t('firstRun.step3Desc') },
          { title: t('firstRun.step4Title'), desc: t('firstRun.step4Desc') },
          { title: t('firstRun.step5Title'), desc: t('firstRun.step5Desc') },
          { title: t('firstRun.step6Title'), desc: t('firstRun.step6Desc') },
          { title: t('firstRun.step7Title'), desc: t('firstRun.step7Desc') },
        ]}
      />

      <h2 className="docs-article-h2">{t('firstRun.localAITools')}</h2>
      <div className="docs-callout">
        <strong>{t('firstRun.whyInstall')}</strong>
        <p>{t('firstRun.whyInstallDesc1')}</p>
        <p style={{ marginTop: '8px' }}>{t('firstRun.whyInstallDesc2')}</p>
      </div>
      <DocCard title={t('firstRun.toolDetection')} eyebrow={t('firstRun.toolDetectionEyebrow')}>
        <DocList
          items={[
            t('firstRun.detectMethod1'),
            t('firstRun.detectMethod2'),
            t('firstRun.detectMethod3'),
            t('firstRun.detectMethod4'),
          ]}
        />
      </DocCard>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('firstRun.claudeInstall')} eyebrow={t('firstRun.claudeInstallEyebrow')}>
          <DocList
            items={[
              t('firstRun.claudeStep1'),
              t('firstRun.claudeStep2'),
              t('firstRun.claudeStep3'),
              t('firstRun.claudeStep4'),
            ]}
          />
        </DocCard>
        <DocCard title={t('firstRun.codexInstall')} eyebrow={t('firstRun.codexInstallEyebrow')}>
          <DocList
            items={[
              t('firstRun.codexStep1'),
              t('firstRun.codexStep2'),
              t('firstRun.codexStep3'),
              t('firstRun.codexStep4'),
            ]}
          />
        </DocCard>
      </div>
      <DocCard title={t('firstRun.installStatus')} eyebrow={t('firstRun.installStatusEyebrow')}>
        <DocList
          items={[
            t('firstRun.statusItem1'),
            t('firstRun.statusItem2'),
            t('firstRun.statusItem3'),
            t('firstRun.statusItem4'),
          ]}
        />
        <p className="docs-card-note">{t('firstRun.statusNote')}</p>
      </DocCard>

      <h2 className="docs-article-h2">{t('firstRun.modelConfig')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('firstRun.localConfig')} eyebrow={t('firstRun.localConfigEyebrow')}>
          <DocList
            items={[
              t('firstRun.localConfigItem1'),
              t('firstRun.localConfigItem2'),
              t('firstRun.localConfigItem3'),
            ]}
          />
        </DocCard>
        <DocCard title={t('firstRun.manualConfig')} eyebrow={t('firstRun.manualConfigEyebrow')}>
          <DocList
            items={[
              t('firstRun.manualConfigItem1'),
              t('firstRun.manualConfigItem2'),
              t('firstRun.manualConfigItem3'),
              t('firstRun.manualConfigItem4'),
            ]}
          />
          <p className="docs-card-note">{t('firstRun.manualConfigNote')}</p>
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('firstRun.accountRules')}</h2>
      <DocCard title={t('firstRun.accountRules')} eyebrow={t('firstRun.accountRulesEyebrow')}>
        <DocList
          items={[
            t('firstRun.accountRule1'),
            t('firstRun.accountRule2'),
            t('firstRun.accountRule3'),
          ]}
        />
        <p className="docs-card-note">{t('firstRun.accountNote')}</p>
      </DocCard>

      <Callout title={t('firstRun.checkTitle')}>
        {t('firstRun.checkDesc')}
      </Callout>
    </>
  )
}