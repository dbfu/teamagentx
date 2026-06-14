/**
 * 从群调度规则中，为「某个业务助手」抽取它参与的环节，并计算每个环节完成后的
 * 「下一棒」交接对象，生成一段「本群任务协作流转（调度方案）」文本，
 * 注入到该助手的系统提示，让它知道自己做什么、做完交接给谁。
 *
 * 仅供业务助手使用；群调度助手另有完整调度规则注入。
 */
import { parseDispatchRulesYaml, type DispatchRulesStep } from './schema.js';

interface PlanEntry {
  workflow: string;
  task: string;
  when?: string;
  onPass?: string;
  onFail?: string;
  parallelWith?: string[]; // 同阶段并行的其它助手
  oneOf?: boolean; // 该环节是「二选一」分配
  next: string[]; // 完成后交接给谁（下一步的助手）
}

// 取某一步涉及的助手名列表
function stepAgents(step: DispatchRulesStep): string[] {
  if ('agent' in step) return [step.agent];
  if ('parallel' in step) return step.parallel.map((b) => b.agent);
  if ('oneOf' in step) return step.oneOf;
  return [];
}

function collectPlan(yamlText: string, agentName: string): PlanEntry[] {
  const parsed = parseDispatchRulesYaml(yamlText);
  if (!parsed.ok || !parsed.data) return [];

  const entries: PlanEntry[] = [];
  for (const wf of parsed.data.workflows) {
    wf.steps.forEach((step, index) => {
      const next = index + 1 < wf.steps.length ? stepAgents(wf.steps[index + 1]) : [];

      if ('agent' in step && step.agent === agentName) {
        entries.push({
          workflow: wf.name,
          task: step.task,
          when: step.when,
          onPass: step.on_pass,
          onFail: step.on_fail,
          next,
        });
      } else if ('parallel' in step) {
        const mine = step.parallel.find((b) => b.agent === agentName);
        if (mine) {
          entries.push({
            workflow: wf.name,
            task: mine.task,
            when: mine.when,
            onPass: mine.on_pass,
            onFail: mine.on_fail,
            parallelWith: step.parallel.map((b) => b.agent).filter((n) => n !== agentName),
            next,
          });
        }
      } else if ('oneOf' in step && step.oneOf.includes(agentName)) {
        entries.push({
          workflow: wf.name,
          task: step.task,
          when: step.when,
          onPass: step.on_pass,
          onFail: step.on_fail,
          oneOf: true,
          next,
        });
      }
    });
  }
  return entries;
}

/** 构建注入业务助手的「任务协作流转（调度方案）」文本块。无相关环节时返回空串。 */
export function buildAgentDispatchPlan(
  dispatchRules: string | null | undefined,
  agentName: string,
  locale?: string,
): string {
  const yamlText = (dispatchRules ?? '').trim();
  if (!yamlText) return '';

  const entries = collectPlan(yamlText, agentName);
  if (entries.length === 0) return '';

  const isZh = (locale ?? 'zh-CN') !== 'en-US';

  const lines = entries.map((e) => {
    const tags: string[] = [];
    if (e.parallelWith && e.parallelWith.length)
      tags.push((isZh ? '与并行：' : 'parallel with: ') + e.parallelWith.join('、'));
    if (e.oneOf) tags.push(isZh ? '二选一（按上一步分配）' : 'one-of (assigned upstream)');
    if (e.when) tags.push((isZh ? '触发条件：' : 'when: ') + e.when);
    const tagStr = tags.length ? `（${tags.join('；')}）` : '';

    const sub: string[] = [];
    if (e.onPass) sub.push(`  - ${isZh ? '通过后' : 'on pass'}：${e.onPass}`);
    if (e.onFail) sub.push(`  - ${isZh ? '不通过' : 'on fail'}：${e.onFail}`);
    if (e.next.length) {
      sub.push(`  - ${isZh ? '下一棒（完成后交接给）' : 'next (hand off to)'}：${e.next.join('、')}`);
    } else {
      sub.push(`  - ${isZh ? '下一棒' : 'next'}：${isZh ? '本流程到此结束，汇报完成即可' : 'end of flow, just report completion'}`);
    }

    const head = `- [${e.workflow}] ${isZh ? '你的任务' : 'your task'}：${e.task}${tagStr}`;
    return `${head}\n${sub.join('\n')}`;
  });

  if (isZh) {
    return [
      '## 本群任务协作流转（调度方案）',
      `本群任务按下面的流程在多个助手之间流转。涉及你（${agentName}）的环节如下；只做自己这一棒，完成后按「下一棒」把任务交接出去：`,
      lines.join('\n'),
      '说明：不要替其它助手做事；需要用户确认或回答时 @群主；具体每次任务以群调度助手下发的消息为准。',
    ].join('\n\n');
  }
  return [
    "## Task collaboration flow (dispatch plan)",
    `Tasks in this room flow across multiple assistants. The steps involving you (${agentName}) are below; do only your step, and after finishing hand off to "next":`,
    lines.join('\n'),
    "Note: do not take over other assistants' steps; @owner when user confirmation is needed; each concrete task still comes from the group coordinator's message.",
  ].join('\n\n');
}
