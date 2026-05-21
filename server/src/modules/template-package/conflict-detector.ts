export interface ExistingTemplateImport {
  templateId: string;
  version: string;
}

export interface DetectTemplateConflictsInput {
  templateId: string;
  version: string;
  desiredGroupName: string;
  existingImports: ExistingTemplateImport[];
  existingGroupNames: string[];
}

export interface DetectTemplateConflictsResult {
  duplicateTemplate: boolean;
  allowedActions: Array<'cancel' | 'create_copy' | 'rename_copy'>;
  suggestedGroupName: string;
}

const DUPLICATE_ACTIONS = ['cancel', 'create_copy', 'rename_copy'] as const;

function buildImportedCopyName(baseName: string, index: number): string {
  return `${baseName}（导入副本 ${index}）`;
}

function suggestGroupName(desiredGroupName: string, existingGroupNames: string[]): string {
  if (!existingGroupNames.includes(desiredGroupName)) {
    return desiredGroupName;
  }

  let nextIndex = 1;
  while (existingGroupNames.includes(buildImportedCopyName(desiredGroupName, nextIndex))) {
    nextIndex += 1;
  }

  return buildImportedCopyName(desiredGroupName, nextIndex);
}

export function detectTemplateConflicts(
  input: DetectTemplateConflictsInput,
): DetectTemplateConflictsResult {
  const duplicateTemplate = input.existingImports.some(
    (item) => item.templateId === input.templateId && item.version === input.version,
  );

  return {
    duplicateTemplate,
    allowedActions: [...DUPLICATE_ACTIONS],
    suggestedGroupName: suggestGroupName(
      input.desiredGroupName,
      input.existingGroupNames,
    ),
  };
}
