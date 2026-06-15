const NO_ASSISTANT_HANDOFF_MARKER =
  '<!-- teamagentx:coordinated-task:no-assistant-handoff -->';

export interface TaskPromptPolicy {
  content: string;
  suppressAssistantHandoff: boolean;
}

export function markTaskWithoutAssistantHandoff(content: string): string {
  if (content.includes(NO_ASSISTANT_HANDOFF_MARKER)) return content;
  return `${content}\n\n${NO_ASSISTANT_HANDOFF_MARKER}`;
}

export function parseTaskPromptPolicy(content: string): TaskPromptPolicy {
  const suppressAssistantHandoff = content.includes(
    NO_ASSISTANT_HANDOFF_MARKER,
  );
  return {
    content: suppressAssistantHandoff
      ? content.replaceAll(NO_ASSISTANT_HANDOFF_MARKER, '').trimEnd()
      : content,
    suppressAssistantHandoff,
  };
}
