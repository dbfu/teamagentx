function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

export function getMentionedKnownUsernames(content: string, usernames: string[]): string[] {
  const mentioned: string[] = [];
  const escapedNames = usernames
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);

  if (escapedNames.length === 0) return mentioned;

  const endBoundaryChars = '*_>#`!?.,:;！？。，；：';
  const nameChars = '\\u4e00-\\u9fa5a-zA-Z0-9_';
  const regex = new RegExp(
    `@(${escapedNames.join('|')})(?=\\s|$|[${endBoundaryChars}]|-(?![${nameChars}]))`,
    'g',
  );

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const atIndex = match.index;
    const prevChar = atIndex > 0 ? content[atIndex - 1] : '';

    if (prevChar && /[A-Za-z0-9._%+-]/.test(prevChar)) {
      continue;
    }

    const username = match[1];
    if (username && !mentioned.includes(username)) {
      mentioned.push(username);
    }
  }

  return mentioned;
}
