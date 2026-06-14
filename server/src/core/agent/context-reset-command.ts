export type ContextResetCommand = '/clear' | '/new';

export function getContextResetCommand(
  message: string,
): ContextResetCommand | undefined {
  const mentionRegex =
    /(?:^|\s|[*_>#`\-])@([\u4e00-\u9fa5a-zA-Z0-9_]+)(?=\s|$)/g;
  const command = message.trim().replace(mentionRegex, '').trim().toLowerCase();

  if (command === '/clear' || command === '/new') {
    return command;
  }

  return undefined;
}
