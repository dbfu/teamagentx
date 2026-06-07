export interface DetectTemplateConflictsInput {
  desiredGroupName: string;
  existingGroupNames: string[];
}

export interface DetectTemplateConflictsResult {
  nameConflict: boolean;
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
  const suggestedGroupName = suggestGroupName(
    input.desiredGroupName,
    input.existingGroupNames,
  );
  const nameConflict = suggestedGroupName !== input.desiredGroupName;

  return {
    nameConflict,
    allowedActions: [...DUPLICATE_ACTIONS],
    suggestedGroupName,
  };
}
