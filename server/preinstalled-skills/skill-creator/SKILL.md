---
name: skill-creator
description: Guide for creating new agent skills. Use this as a reference when generating SKILL.md files from conversation history.
---

# Skill Creator Guide

This skill provides templates and best practices for creating new agent skills.

## SKILL.md Structure

Every skill must have a `SKILL.md` file with the following structure:

```markdown
---
name: {skill-name}
description: {Brief description of what this skill does}
---

# {Skill Title}

{Detailed skill content}
```

## Skill Types

### 1. Knowledge Type

Store domain knowledge, best practices, code templates.

```markdown
---
name: react-best-practices
description: React development best practices and patterns
---

# React Best Practices

## When to Use

When developing React applications, components, or hooks.

## Core Knowledge

### Component Design
- Keep components small and focused
- Use composition over inheritance
- Extract reusable logic into custom hooks

### State Management
- Lift state up when needed
- Use context for global state
- Consider Zustand/Redux for complex state

## Examples

### Custom Hook Pattern
\`\`\`typescript
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
\`\`\`
```

### 2. Workflow Type

Define step-by-step processes.

```markdown
---
name: bug-fix-workflow
description: Standard bug fix workflow to ensure thorough resolution
---

# Bug Fix Workflow

## When to Use

When a bug is reported or discovered.

## Workflow Steps

1. **Reproduce**: Confirm the bug can be reproduced
2. **Isolate**: Find the root cause
3. **Fix**: Implement the solution
4. **Verify**: Test the fix works
5. **Document**: Update relevant docs

## Checklist

- [ ] Bug reproduced locally
- [ ] Root cause identified
- [ ] Fix implemented
- [ ] Tests added/updated
- [ ] Code reviewed
- [ ] Documentation updated
```

### 3. Tool Type

Document how to use specific tools or APIs.

```markdown
---
name: api-integration
description: How to integrate with Example API
---

# Example API Integration

## When to Use

When integrating with Example API services.

## Authentication

\`\`\`typescript
const client = new ExampleClient({
  apiKey: process.env.EXAMPLE_API_KEY,
});
\`\`\`

## Common Operations

### Create Resource

\`\`\`typescript
const result = await client.resources.create({
  name: 'My Resource',
  type: 'standard',
});
\`\`\`

### List Resources

\`\`\`typescript
const resources = await client.resources.list({
  limit: 10,
  offset: 0,
});
\`\`\`

## Error Handling

| Error Code | Meaning | Action |
|------------|---------|--------|
| 401 | Unauthorized | Check API key |
| 429 | Rate limited | Retry with backoff |
| 500 | Server error | Retry or contact support |
```

## Best Practices

1. **Clear Trigger Conditions**: Define when the skill should be used
2. **Concrete Examples**: Include real code snippets
3. **Concise Content**: Focus on actionable information
4. **Proper Formatting**: Use markdown headers, lists, and code blocks
5. **Version Control**: Track changes to skills over time

## Naming Conventions

- Use lowercase letters and hyphens: `my-skill-name`
- Be descriptive but concise
- Match the skill's purpose

## File Structure

```
my-skill/
├── SKILL.md          # Required: Main skill definition
├── examples/         # Optional: Example files
├── templates/        # Optional: Code templates
└── .skills/
    └── origin.json   # Auto-generated: Installation metadata
```
