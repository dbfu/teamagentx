// 触发模式归一化
// 历史上群聊有三种模式：auto（自由协作）/ coordinator（协调模式）/ manual（手动）。
// auto 与 coordinator 已合并为「智能协作」，存储值统一为 'coordinator'；
// 存量 'auto' 通过数据迁移转换，这里在读取层再做一次别名兜底（模板导入等旧数据）。

export type NormalizedTriggerMode = 'coordinator' | 'manual';

export function normalizeTriggerMode(mode?: string | null): NormalizedTriggerMode {
  return mode === 'manual' ? 'manual' : 'coordinator';
}

/** 是否智能协作模式（合并后的 auto + coordinator）。 */
export function isSmartCollaborationMode(mode?: string | null): boolean {
  return normalizeTriggerMode(mode) === 'coordinator';
}
