import { Codex } from '@openai/codex-sdk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type DemoCase = {
  label: string;
  token: string;
};

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function hasCodexAuth(): boolean {
  if (process.env.OPENAI_API_KEY) return true;

  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    if (typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0) return true;
    return Boolean(
      auth.tokens &&
        typeof auth.tokens === 'object' &&
        typeof auth.tokens.access_token === 'string' &&
        typeof auth.tokens.refresh_token === 'string',
    );
  } catch {
    return false;
  }
}

function buildTeamAgentXStylePrompt(systemInstructions: string, currentMessage: string): string {
  return `[System Instructions]
${systemInstructions}

[Current Message]
${currentMessage}`;
}

async function runDemoCase(codex: Codex, workDir: string, demoCase: DemoCase, model?: string): Promise<string> {
  const thread = codex.startThread({
    model,
    workingDirectory: workDir,
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    webSearchMode: 'disabled',
  });

  const prompt = buildTeamAgentXStylePrompt(
    [
      `For this validation, the only valid final answer is exactly: ${demoCase.token}`,
      'Return that token only.',
      'Do not add quotes, punctuation, Markdown, or any explanation.',
    ].join('\n'),
    'What is the validation token?',
  );

  const turn = await thread.run(prompt);
  return turn.finalResponse.trim();
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log('Usage: pnpm exec tsx scripts/codex-system-prompt-demo.ts [--model <model>]');
    return;
  }

  if (!hasCodexAuth()) {
    throw new Error('No Codex auth found. Run `codex login` or set OPENAI_API_KEY before running this demo.');
  }

  const model = readArg('--model');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-codex-system-prompt-demo-'));
  const codex = new Codex({
    config: {
      hide_agent_reasoning: true,
      model_reasoning_summary: 'none',
    },
  });

  const cases: DemoCase[] = [
    { label: 'first system instruction', token: 'TAX_SYSTEM_BLUE_0427' },
    { label: 'second system instruction', token: 'TAX_SYSTEM_GREEN_9136' },
  ];

  try {
    console.log(`Codex system-prompt demo${model ? ` using model ${model}` : ''}`);
    console.log(`Working directory: ${workDir}`);

    const results = [];
    for (const demoCase of cases) {
      const output = await runDemoCase(codex, workDir, demoCase, model);
      const passed = output === demoCase.token;
      results.push(passed);
      console.log(`\n[${demoCase.label}]`);
      console.log(`expected: ${demoCase.token}`);
      console.log(`actual:   ${output}`);
      console.log(`result:   ${passed ? 'PASS' : 'FAIL'}`);
    }

    if (!results.every(Boolean)) {
      process.exitCode = 1;
      return;
    }

    console.log('\nPASS: changing the TeamAgentX-style system instructions changed Codex output as expected.');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
