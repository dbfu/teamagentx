interface TemplateImportPreview {
  conflicts: {
    nameConflict: boolean;
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
  const finalGroupName = input.preview.conflicts.nameConflict
    ? input.preview.conflicts.suggestedGroupName
    : input.desiredGroupName.trim() || input.preview.conflicts.suggestedGroupName;

  const unresolvedCount = input.preview.compatibility.unresolved.filter((item: any) =>
    item?.status === 'requires_user_selection',
  ).length;

  return {
    finalGroupName,
    unresolvedCount,
    importAction: input.preview.conflicts.nameConflict ? 'rename_copy' : 'create_copy' as const,
  };
}
