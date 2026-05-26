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
  preview: TemplateImportPreview;
}

export function buildTemplateImportPlan(input: BuildTemplateImportPlanInput) {
  const finalGroupName = input.preview.conflicts.suggestedGroupName;

  const unresolvedCount = input.preview.compatibility.unresolved.filter((item: any) =>
    item?.status === 'requires_user_selection',
  ).length;

  return {
    finalGroupName,
    unresolvedCount,
    importAction: finalGroupName === input.desiredGroupName ? 'create_copy' : 'rename_copy' as const,
  };
}
