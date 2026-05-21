type DuplicateAction = 'cancel' | 'create_copy' | 'rename_copy';

interface TemplateImportPreview {
  conflicts: {
    duplicateTemplate: boolean;
    suggestedGroupName: string;
  };
  compatibility: {
    resolved: unknown[];
    unresolved: unknown[];
  };
}

interface BuildTemplateImportPlanInput {
  desiredGroupName: string;
  duplicateAction: DuplicateAction;
  preview: TemplateImportPreview;
}

export function buildTemplateImportPlan(input: BuildTemplateImportPlanInput) {
  if (input.duplicateAction === 'cancel') {
    throw new Error('用户取消了导入操作');
  }

  const finalGroupName = input.duplicateAction === 'rename_copy'
    ? input.preview.conflicts.suggestedGroupName
    : input.desiredGroupName;

  const unresolvedCount = input.preview.compatibility.unresolved.filter((item: any) =>
    item?.status === 'requires_user_selection',
  ).length;

  return {
    finalGroupName,
    unresolvedCount,
  };
}
