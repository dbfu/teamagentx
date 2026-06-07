import { Callout, Code, DocCard, DocList, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function ModelsPage() {
  const { t } = useLanguage()
  return (
    <>
      <ManualHeader
        eyebrow={t('models.eyebrow')}
        title={t('models.title')}
        intro={t('models.intro')}
      />

      <h2 className="docs-article-h2">{t('models.pageEntry')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('models.toolbar')} eyebrow={t('models.toolbarEyebrow')}>
          <DocList
            items={[
              t('models.toolbarItem1'),
              t('models.toolbarItem2'),
              t('models.toolbarItem3'),
              t('models.toolbarItem4'),
              t('models.toolbarItem5'),
            ]}
          />
        </DocCard>
        <DocCard title={t('models.listActions')} eyebrow={t('models.listActionsEyebrow')}>
          <DocList
            items={[
              t('models.listActionsItem1'),
              t('models.listActionsItem2'),
              t('models.listActionsItem3'),
              t('models.listActionsItem4'),
              t('models.listActionsItem5'),
              t('models.listActionsItem6'),
            ]}
          />
        </DocCard>
      </div>
      <p className="docs-article-p">{t('models.listFilterNote')}</p>

      <h2 className="docs-article-h2">{t('models.addTextModel')}</h2>
      <DocCard title={t('models.addTextModel')} eyebrow={t('models.textModelEyebrow')}>
        <DocList
          items={[
            <><strong>{t('models.textModelItem1')}</strong></>,
            <><strong>{t('models.textModelItem2')}</strong></>,
            <><strong>{t('models.textModelItem3')}</strong></>,
            <><strong>{t('models.textModelItem4')}</strong></>,
            <><strong>{t('models.textModelItem5')}</strong></>,
            <><strong>{t('models.textModelItem6')}</strong></>,
          ]}
        />
      </DocCard>

      <h2 className="docs-article-h2">{t('models.addImageModel')}</h2>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('models.addImageModel')} eyebrow={t('models.imageModelEyebrow')}>
          <DocList
            items={[
              t('models.imageModelItem1'),
              t('models.imageModelItem2'),
              <>API URL：{t('models.imageModelItem3')}</>,
              t('models.imageModelItem4'),
            ]}
          />
        </DocCard>
        <DocCard title={t('models.providerNotes')} eyebrow={t('models.providerNotesEyebrow')}>
          <DocList
            items={[
              t('models.providerNotesItem1'),
              <>百炼 / 万相推荐使用 <Code>wan2.6-t2i</Code> 这类图片模型。</>,
              <>智谱推荐填写 <Code>glm-image</Code> 这类图片模型 ID。</>,
              t('models.providerNotesItem4'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('models.addVoiceModel')}</h2>
      <DocCard title={t('models.addVoiceModel')} eyebrow={t('models.voiceModelEyebrow')}>
        <DocList
          items={[
            t('models.voiceModelItem1'),
            <>朗读接口会自动追加 <Code>/audio/speech</Code>，识别接口会自动追加 <Code>/audio/transcriptions</Code>。</>,
            t('models.voiceModelItem3'),
            t('models.voiceModelItem4'),
          ]}
        />
      </DocCard>

      <h2 className="docs-article-h2">{t('models.codexChinese')}</h2>
      <div className="docs-callout">
        <strong>{t('models.chineseLLM')}</strong>
        <p>{t('models.chineseLLMDesc')}</p>
      </div>
      <DocCard title={t('models.chineseProviders')} eyebrow={t('models.chineseProvidersEyebrow')}>
        <DocList
          items={[
            <><strong>{t('models.chineseProviderItem1')}</strong></>,
            <><strong>{t('models.chineseProviderItem2')}</strong></>,
            <><strong>{t('models.chineseProviderItem3')}</strong></>,
            t('models.chineseProviderItem4'),
          ]}
        />
      </DocCard>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('models.setupNotes')} eyebrow={t('models.setupNotesEyebrow')}>
          <DocList
            items={[
              t('models.setupNotesItem1'),
              t('models.setupNotesItem2'),
              t('models.setupNotesItem3'),
              t('models.setupNotesItem4'),
              <><strong>{t('models.setupNotesItem5')}</strong></>,
            ]}
          />
        </DocCard>
        <DocCard title={t('models.aggregatorPlatforms')} eyebrow={t('models.aggregatorPlatformsEyebrow')}>
          <DocList
            items={[
              <><strong>SiliconFlow</strong>：{t('models.aggregatorItem1')}</>,
              <><strong>OpenRouter</strong>：{t('models.aggregatorItem2')}</>,
              t('models.aggregatorItem3'),
            ]}
          />
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('models.importExport')}</h2>
      <DocCard title={t('models.importExport')} eyebrow={t('models.importExportEyebrow')}>
        <DocList
          items={[
            t('models.importExportItem1'),
            t('models.importExportItem2'),
            t('models.importExportItem3'),
            t('models.importExportItem4'),
          ]}
        />
      </DocCard>

      <Callout title={t('models.usageTipsTitle')}>
        {t('models.usageTipsDesc')}
      </Callout>
    </>
  )
}