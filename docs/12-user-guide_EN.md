# 12 · TeamAgentX User Guide: Quick Start for Beginners

[English](12-user-guide_EN.md) | [中文](12-user-guide.md)

> For users trying TeamAgentX for the first time. After reading this guide, you should be able to complete initialization, create assistants and groups, and initiate a trackable multi-agent collaboration using `@assistant-name`.

## 1. Understand 5 Key Concepts First

Using TeamAgentX is similar to "inviting multiple AI colleagues into a project group."

| Concept | Simple Understanding | What You Need to Do |
|---------|---------------------|---------------------|
| Model | The AI's brain, such as Claude, OpenAI-compatible models, DeepSeek, etc. | Configure API Key / API URL / Model name, or use local Claude/Codex configuration |
| Skill | A specialized capability package for assistants, such as code review, documentation writing, image processing | Install skills to assistants that need them |
| Assistant | An AI member with a role, model, prompt, and skills | Create or edit assistants, such as "Engineer", "QA", "Documenter" |
| Group | A project workspace containing members, rules, working directory, and message history | Create a group for each project and add relevant assistants |
| Working Directory | The local directory where assistants actually read and write files | Select a project directory when creating a group to avoid assistants modifying the wrong location |

The most common interaction is simple: type `@assistant-name task content` in a group.

## 2. Recommended Getting Started Path

For first-time use, follow this sequence:

1. Open the application and complete the initial setup.
2. Configure or confirm the default AI tool / model.
3. Create at least one assistant.
4. Create a group, select a working directory, and add assistants.
5. Type `@assistant-name` in the group to assign a task.
6. Track progress and issues through the task board, execution records, and context panel.

If you just want to ask an assistant a quick question temporarily, you can skip creating a group and use "Quick Chat" directly.

## 3. Initial Setup

When entering the system for the first time, you'll see an initialization wizard:

1. Click "Start Setup".
2. Select the default engine in "Tool Detection". The system will detect local Claude / Codex and other AI tools.
3. Choose whether to use local configuration or manually enter API configuration in "Model Configuration".
4. Create a local account by filling in username, password, and avatar.
5. Enter the main interface after completion.

If no local AI tools are detected, you can install them first, or manually add API models later on the "Models" page.

## 4. Main Interface Navigation

The left sidebar contains main feature entries:

| Entry | Purpose |
|-------|---------|
| Group Chat | View project groups, create groups, chat and collaborate |
| Assistants | Create, edit, and categorize assistants; initiate quick chats |
| Skills | View shared skills, import external skills, install skills to assistants |
| Models | Manage text, image, voice and other model configurations |
| Settings | Modify personal info, theme, notification sounds, mobile connection, and local tool execution methods |

## 5. Configuring Models

After entering the "Models" page, you can:

- Click "Add Model" to manually add a model configuration.
- Click "AI Create" to paste API information in natural language and let the system automatically parse the form.
- Import / Export JSON to batch migrate model configurations.
- Test connection to confirm API Key, API URL, and model name are usable.
- Set a default model for new assistants or system assistants to use preferentially.

Common text assistant configuration fields:

| Field | Description |
|-------|-------------|
| Name | For your own identification, e.g., "DeepSeek Chat" |
| Protocol | Select Anthropic for Claude; OpenAI for OpenAI-compatible services |
| API URL | The interface address provided by the service provider |
| API Key | The service provider's key |
| Model | Model ID, e.g., `deepseek-chat`, `gpt-4.1`, etc. |

If you use local Claude Code / Codex, you can select "Do not bind to a model provider, use local Agent configuration" in the assistant settings.

## 6. Creating Assistants

Go to the "Assistants" page and click "Create Assistant".

It's recommended to create 3 types of assistants first:

| Assistant | Good For | Prompt Focus |
|-----------|----------|--------------|
| Coordinator | Understanding requirements, breaking down tasks, coordinating other assistants | Clarify goals first, then break down steps, @ other assistants when necessary |
| Engineer | Writing code, modifying files, running commands | Strictly follow the working directory, explain what was changed and how to verify after completion |
| QA | Reviewing implementations, finding issues, providing acceptance feedback | Prioritize finding bugs, risks, and missing tests; don't modify code directly |

Key fields when creating an assistant:

1. **Name**: Used to trigger with `@name` in group chats.
2. **Model Provider**: Select an available model, or use local Agent configuration.
3. **Description**: Helps you identify the assistant's purpose.
4. **Prompt**: Define the assistant's role, boundaries, and output format.
5. **Skills**: Install specialized capabilities as needed.
6. **Working Directory**: Can be left empty; usually controlled by the group's working directory.

You can start with a simple prompt and use "AI Optimize" to improve it.

## 7. Managing Skills

Go to the "Skills" page to view installed skills.

Common operations:

- "Import External Skill": Scan and import an external skill directory.
- "Create Symbolic Link": Suitable for reusing external skill directories; external updates will sync.
- "Full Copy": Suitable for keeping a fixed copy of a skill, unaffected by external directories.
- "Install to Assistant": Assign a skill to one or more assistants.
- Type `@Group Assistant` in group chat: Let the system assistant help create new skills (the Group Assistant now covers agent/skill/cron/room-info system capabilities all in one).

Recommendations:

- Don't install all skills to all assistants. More skills make it easier for assistants to deviate from their roles.
- Install code-related skills for engineers, review/verify skills for QA, and writing skills for documenters.

## 8. Creating a Group

Go to "Group Chat" and click "Create Group".

Fill in the following when creating:

| Field | Suggestion |
|-------|------------|
| Group Name | Use project or task name, e.g., "Website Refactor" |
| Group Description | Clearly state the group's goals |
| Working Directory | Select the project root directory. Desktop version can select folders directly |
| Select Assistants | Add Coordinator, Engineer, QA, and other members |
| Inject Group History | Enabled by default. Enable when you want new assistants to understand context; disable if you only want them to see new tasks |

After creating a group, all assistants in it share the group's working directory. We recommend one project per group—don't put multiple unrelated projects in the same group.

## 9. Configuring Group Rules

Open "Settings" or "Group Rules" at the top of the group to edit group rules. Group rules are injected into all assistants' context in the group.

You can use this template directly:

```text
- All responses should use English.
- Explain the plan before executing, summarize changes and verification results after execution.
- Ask questions when unsure about requirements; don't expand scope on your own.
- Code modifications must prioritize following the existing style of the current repository.
- Clearly explain blocking reasons when encountering decisions needed from users, insufficient permissions, command failures, or test failures.
- QA only reviews and suggests; don't modify code directly unless explicitly requested by the user.
```

## 10. Choosing Assistant Trigger Mode

In group settings, there's an "Assistant Trigger Mode" — now only two:

| Mode | Behavior | Suitable For |
|------|----------|--------------|
| Smart Collaboration (default) | A single `@` relays directly (fast path); on ambiguity/join/stall the system "Group Coordinator" steps in; `@`-ing multiple assistants at once runs them in parallel | Recommended for beginners, fits the vast majority of groups |
| Manual Mode | `@` in assistant messages only shows mention, doesn't trigger execution | Use when you want full control over dispatching |

Beginners can just use "Smart Collaboration" — it has a built-in collaboration budget (hop/cycle/concurrency breakers) against loops/fan-out, and on a trip it `@`s the owner instead of looping forever. You can also orchestrate multi-assistant order via "Dispatch Rules".

## 11. Initiating a Group Collaboration

In the group input box, type:

```text
@Coordinator Please help me check how to start this project, summarize the local development steps, and let the engineer verify if it can start.
```

For more direct tasks, you can write:

```text
@Engineer Please read README and package.json, tell me how to start the Web and backend services. Don't modify files.
```

If the group has a default receiving assistant configured, messages without `@` will be automatically forwarded to that assistant. However, for important tasks, we recommend explicitly using `@` to reduce ambiguity.

After sending, you can observe:

- Streaming output in message bubbles.
- Tool call processes.
- Whether assistants are executing, queuing, or completed.
- Task queue, execution records, and context in the right panel.

## 12. Using Quick Chat

Quick Chat is suitable for 1-on-1 temporary questions without needing to create a formal group.

How to use:

1. Go to the "Assistants" page.
2. Find the target assistant.
3. Click "Quick Chat".
4. You can select a working directory; if left empty, the system will create an independent session directory.
5. After entering the conversation, send messages directly without `@`.

Suitable scenarios for Quick Chat:

- Asking about a concept.
- Having an assistant temporarily analyze a piece of text.
- Testing whether an assistant's prompt is effective.

Unsuitable scenarios for Quick Chat:

- Multi-assistant collaboration.
- Need to preserve project context long-term.
- Need to work continuously around a fixed project directory.

## 13. Viewing Tasks and Execution Process

Common buttons at the top of a group:

| Feature | Purpose |
|---------|---------|
| Members | View assistants in the group, enter assistant details |
| Add Assistant | Add new assistants to the current group |
| Task Board | View pending, executing, completed, failed/cancelled, and waiting-to-resume tasks |
| Stop All Tasks | Stop current group execution when tasks go out of control or you don't want to continue |
| Scheduled Tasks | Create and manage group-level automated tasks |
| Screenshot Chat | Export current chat history as an image |
| Clear Messages | Clear current group messages |
| Group Settings | Modify name, working directory, trigger mode, default assistant, group rules |

Common features in assistant details:

- "View Context": See what context the assistant actually received.
- "Execution History": View historical execution records.
- "Task Queue": View the assistant's current queue and execution status.
- "Clear Context": Reset the assistant's memory in the current group.

When an assistant gives irrelevant answers, remembers wrong information, or the context is too messy, prioritize using "Clear Context".

## 14. Creating Scheduled Tasks

Group-level scheduled tasks can send messages to the group at scheduled times and trigger assistants.

How to use:

1. Open "Scheduled Tasks" at the top of the group.
2. Click "Create Task".
3. Fill in task name and description.
4. Select schedule type: Cron expression, fixed interval, or one-time execution.
5. Fill in execution content.
6. Select the assistant to trigger. Don't manually write `@assistant-name` in the execution content—the system will handle it automatically based on your selection.
7. Set maximum retry count and whether to enable immediately.

Examples:

| Scenario | Configuration |
|----------|---------------|
| Sync project status every morning | Every day at 9 AM, trigger Coordinator to summarize yesterday's progress and today's todos |
| Write change summary every week | Every Friday at 6 PM, trigger Documenter to generate changelog draft |
| Periodic service patrol | Fixed interval, trigger Monitor assistant to check service status |

## 15. Working Directory Best Practices

The working directory determines where assistants can run commands and read/write files.

Recommended practices:

- Create one group per project and set the working directory to the project root.
- Don't set the working directory to your home directory or an overly large parent directory.
- When multiple assistants need to collaborate on the same project, put them in the same group.
- For temporary experiments, use Quick Chat's independent directory to avoid polluting formal projects.
- Desktop version can copy and open working directories; Web version is limited by browsers and has fewer directory capabilities.

## 16. Mobile Connection

Find "Mobile Connection" in "Settings":

1. Confirm that your computer and phone are on the same LAN.
2. Select an available LAN address.
3. Generate a QR code.
4. Scan with the TeamAgentX App or QR scan entry on your phone.
5. The phone will automatically log in and connect to the corresponding service.

If connection fails after scanning, check:

- Whether phone and computer are on the same network.
- Whether the selected LAN IP in settings is correct.
- Whether the firewall is blocking access.
- Whether the desktop service is still running.

## 17. Common Issues

### Assistant Not Responding

Check:

- Whether you explicitly used `@assistant-name`.
- Whether the assistant has been added to the group.
- Whether the model configuration is enabled and connection test passed.
- Whether there are tasks currently queuing.
- Whether Socket / server connection is normal.

### Assistant Using Wrong Project Directory

Check "Working Directory" in group settings. If the directory is empty, the system will use the default group directory. For formal projects, we recommend explicitly selecting the project root directory.

### Assistants Triggering Each Other Too Much

Change "Assistant Trigger Mode" in group settings to "Manual Mode", then explicitly `@` each assistant.

### Assistant Context is Messy

Go to assistant details, first "View Context" to confirm what it sees; click "Clear Context" if necessary. For newly added assistants, turn off "Inject Group History" as needed.

### Model Unavailable

Go to the "Models" page and check:

- Whether API URL is correct.
- Whether API Key is valid.
- Whether Model ID is spelled correctly.
- Whether Protocol is selected correctly—use Anthropic for Claude, OpenAI for OpenAI-compatible services.
- Whether the model configuration is enabled.

### Cannot Open Directory in Desktop Version

Directory opening capability is only fully supported in the Electron desktop version. The Web version is limited by browsers and may only be able to copy the path.

## 18. Recommended Beginner Configuration

Minimum viable combination:

| Item | Recommendation |
|------|----------------|
| Model | Configure one stable text model and set as default |
| Assistants | Coordinator + Engineer + QA |
| Groups | One project per group |
| Trigger Mode | Smart Collaboration (default) |
| Group Rules | Use the template from Section 9 |
| Working Directory | Project root directory |

For the first verification, you can send:

```text
@Coordinator Please familiarize yourself with the current project, explain what it is, how to start it, and what's in the main directories. Don't modify any files yet.
```

After confirming that the assistant can correctly read the project and explain how to start it, you can let it execute more specific development tasks.