import { Callout, Code, CodeBlock, DocCard, DocList, DocTable, ManualHeader } from '../docs-ui'
import { useLanguage } from '../../i18n/context'

export function ChatroomsPage() {
  const { t } = useLanguage()
  return (
    <>
      <ManualHeader
        eyebrow={t('chatrooms.eyebrow')}
        title={t('chatrooms.title')}
        intro={t('chatrooms.intro')}
      />

      <h2 className="docs-article-h2">{t('chatrooms.createGroup')}</h2>
      <DocCard title={t('chatrooms.createGroup')} eyebrow={t('chatrooms.createGroupEyebrow')}>
        <DocList
          items={[
            <><strong>{t('chatrooms.configItem1')}</strong></>,
            <><strong>{t('chatrooms.configItem2')}</strong></>,
            <><strong>{t('chatrooms.configItem3')}</strong></>,
            <><strong>{t('chatrooms.configItem4')}</strong></>,
            <><strong>{t('chatrooms.configItem5')}</strong></>,
            <><strong>{t('chatrooms.configItem6')}</strong></>,
          ]}
        />
        <p className="docs-card-note">{t('chatrooms.configNote')}</p>
      </DocCard>

      <h2 className="docs-article-h2">{t('chatrooms.sendMessage')}</h2>
      <p className="docs-article-p">{t('chatrooms.sendMessageDesc')}</p>
      <CodeBlock>{`@产品助手 @代码助手 请评估这个需求是否容易实现。`}</CodeBlock>
      <p className="docs-article-p">{t('chatrooms.sendMessageNote')}</p>

      <h2 className="docs-article-h2">{t('chatrooms.collabMode')}</h2>
      <p className="docs-article-p">
        {t('chatrooms.collabModeDesc')}
      </p>

      <Callout title={t('chatrooms.keyRuleTitle')}>
        {t('chatrooms.keyRuleDesc')}
      </Callout>

      <h3 className="docs-article-h3">{t('chatrooms.coordinatorMode')}</h3>
      <DocCard title={t('chatrooms.coordinatorDesc')} eyebrow={t('chatrooms.coordinatorEyebrow')}>
        <DocList
          items={[
            <>用户 <strong>@ 指定助手</strong> 时，{t('chatrooms.coordinatorItem1')}</>,
            <>用户<strong>没有 @</strong> 的消息，以及<strong>任何助手发出的消息</strong>，{t('chatrooms.coordinatorItem2')}</>,
            <>只有协调助手在中继派发时，才能在一条消息里<strong>同时触发多个助手</strong>，{t('chatrooms.coordinatorItem3')}</>,
            t('chatrooms.coordinatorItem4'),
          ]}
        />
        <p className="docs-card-note">{t('chatrooms.coordinatorNote')}</p>
      </DocCard>

      <h3 className="docs-article-h3">{t('chatrooms.freeMode')}</h3>
      <DocCard title={t('chatrooms.freeModeDesc')} eyebrow={t('chatrooms.freeModeEyebrow')}>
        <DocList
          items={[
            <>有 <strong>@</strong> 时，{t('chatrooms.freeModeItem1')}</>,
            <>没有 @ 的用户消息，{t('chatrooms.freeModeItem2')}</>,
            <>如果没有配置默认接收助手，但当前消息是<strong>回复某条助手消息</strong>，{t('chatrooms.freeModeItem3')}</>,
          ]}
        />
        <p className="docs-card-note">{t('chatrooms.freeModeNote')}</p>
      </DocCard>

      <h3 className="docs-article-h3">{t('chatrooms.manualMode')}</h3>
      <DocCard title={t('chatrooms.manualModeDesc')} eyebrow={t('chatrooms.manualModeEyebrow')}>
        <DocList
          items={[
            <>只有用户 <strong>@ 指定助手</strong> 时才触发，{t('chatrooms.manualModeItem1')}</>,
            <>助手消息里的 @ <strong>只作为提及展示</strong>，{t('chatrooms.manualModeItem2')}</>,
            t('chatrooms.manualModeItem3'),
          ]}
        />
        <p className="docs-card-note">{t('chatrooms.manualModeNote')}</p>
      </DocCard>

      <h3 className="docs-article-h3">{t('chatrooms.modeCompare')}</h3>
      <DocTable
        headers={[t('chatrooms.compareHeader1'), t('chatrooms.compareHeader2'), t('chatrooms.compareHeader3'), t('chatrooms.compareHeader4')]}
        rows={[
          [t('chatrooms.compareRow1Col1'), t('chatrooms.compareRow1Col2'), t('chatrooms.compareRow1Col3'), t('chatrooms.compareRow1Col4')],
          [t('chatrooms.compareRow2Col1'), t('chatrooms.compareRow2Col2'), t('chatrooms.compareRow2Col3'), t('chatrooms.compareRow2Col4')],
          [t('chatrooms.compareRow3Col1'), t('chatrooms.compareRow3Col2'), t('chatrooms.compareRow3Col3'), t('chatrooms.compareRow3Col4')],
          [t('chatrooms.compareRow4Col1'), t('chatrooms.compareRow4Col2'), t('chatrooms.compareRow4Col3'), t('chatrooms.compareRow4Col4')],
        ]}
      />

      <h2 className="docs-article-h2">{t('chatrooms.groupSettings')}</h2>
      <p className="docs-article-p">{t('chatrooms.groupSettingsDesc')}</p>
      <div className="docs-grid docs-grid-2">
        <DocCard title={t('chatrooms.workDir')} eyebrow={t('chatrooms.workDirEyebrow')}>
          <DocList
            items={[
              t('chatrooms.workDirItem1'),
              t('chatrooms.workDirItem2'),
              t('chatrooms.workDirItem3'),
              <>留空时使用默认目录：<Code>~/.teamagentx/workspace/&lt;群聊ID&gt;</Code>。</>,
            ]}
          />
        </DocCard>
        <DocCard title={t('chatrooms.groupRules')} eyebrow={t('chatrooms.groupRulesEyebrow')}>
          <p className="docs-card-note">{t('chatrooms.groupRulesNote')}</p>
          <CodeBlock>{t('chatrooms.groupRulesExample')}</CodeBlock>
        </DocCard>
      </div>

      <h2 className="docs-article-h2">{t('chatrooms.memberManage')}</h2>
      <DocCard title={t('chatrooms.memberManage')} eyebrow={t('chatrooms.memberManageEyebrow')}>
        <DocList
          items={[
            t('chatrooms.memberManageItem1'),
            t('chatrooms.memberManageItem2'),
            t('chatrooms.memberManageItem3'),
            t('chatrooms.memberManageItem4'),
          ]}
        />
      </DocCard>

      <h2 className="docs-article-h2">{t('chatrooms.taskExecution')}</h2>
      <DocCard title={t('chatrooms.taskExecution')} eyebrow={t('chatrooms.taskExecutionEyebrow')}>
        <DocList
          items={[
            t('chatrooms.taskExecutionItem1'),
            t('chatrooms.taskExecutionItem2'),
            t('chatrooms.taskExecutionItem3'),
            t('chatrooms.taskExecutionItem4'),
            t('chatrooms.taskExecutionItem5'),
            t('chatrooms.taskExecutionItem6'),
          ]}
        />
        <p className="docs-card-note">{t('chatrooms.taskExecutionNote')}</p>
      </DocCard>

      <Callout title={t('chatrooms.moreFeaturesTitle')}>
        {t('chatrooms.moreFeaturesDesc')}
      </Callout>
    </>
  )
}