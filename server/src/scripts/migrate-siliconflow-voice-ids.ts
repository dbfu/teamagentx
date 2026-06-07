import prisma from '../lib/prisma.js';
import { deserializeAgentSpeechConfig, serializeAgentSpeechConfig } from '../modules/speech/speech-config.js';

const SILICONFLOW_COSYVOICE2_MODEL = 'FunAudioLLM/CosyVoice2-0.5B';

const LEGACY_SILICONFLOW_VOICE_MAP: Record<string, string> = {
  '中文女声': `${SILICONFLOW_COSYVOICE2_MODEL}:anna`,
  '中文男声': `${SILICONFLOW_COSYVOICE2_MODEL}:alex`,
  '英文女声': `${SILICONFLOW_COSYVOICE2_MODEL}:diana`,
  '英文男声': `${SILICONFLOW_COSYVOICE2_MODEL}:benjamin`,
  '粤语女声': `${SILICONFLOW_COSYVOICE2_MODEL}:bella`,
  '日语男声': `${SILICONFLOW_COSYVOICE2_MODEL}:charles`,
  '韩语女声': `${SILICONFLOW_COSYVOICE2_MODEL}:claire`,
  anna: `${SILICONFLOW_COSYVOICE2_MODEL}:anna`,
  bella: `${SILICONFLOW_COSYVOICE2_MODEL}:bella`,
  claire: `${SILICONFLOW_COSYVOICE2_MODEL}:claire`,
  diana: `${SILICONFLOW_COSYVOICE2_MODEL}:diana`,
  alex: `${SILICONFLOW_COSYVOICE2_MODEL}:alex`,
  benjamin: `${SILICONFLOW_COSYVOICE2_MODEL}:benjamin`,
  charles: `${SILICONFLOW_COSYVOICE2_MODEL}:charles`,
  david: `${SILICONFLOW_COSYVOICE2_MODEL}:david`,
};

function migrateVoiceValue(model: string | null | undefined, voice: string | null | undefined): string | null | undefined {
  if (model !== SILICONFLOW_COSYVOICE2_MODEL || !voice?.trim()) {
    return voice;
  }

  const trimmedVoice = voice.trim();
  if (trimmedVoice.startsWith('speech:') || trimmedVoice.startsWith(`${SILICONFLOW_COSYVOICE2_MODEL}:`)) {
    return trimmedVoice;
  }

  return LEGACY_SILICONFLOW_VOICE_MAP[trimmedVoice] ?? trimmedVoice;
}

export async function migrateSiliconflowVoiceIds(): Promise<void> {
  console.log('[migrate-siliconflow-voice-ids] 检查是否需要迁移助手语音音色...');

  const agents = await prisma.agent.findMany({
    where: {
      speechConfig: {
        not: null,
      },
    },
    select: {
      id: true,
      name: true,
      speechConfig: true,
    },
  });

  let updated = 0;

  for (const agent of agents) {
    const parsed = deserializeAgentSpeechConfig(agent.speechConfig);
    if (!parsed) continue;

    const nextVoice = migrateVoiceValue(parsed.profile.model, parsed.profile.voice);
    if (nextVoice === parsed.profile.voice) continue;

    const nextConfig = {
      ...parsed,
      profile: {
        ...parsed.profile,
        voice: nextVoice ?? null,
      },
    };

    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        speechConfig: serializeAgentSpeechConfig(nextConfig),
      },
    });

    console.log(
      `[migrate-siliconflow-voice-ids] ${agent.name}: "${parsed.profile.voice ?? 'null'}" -> "${nextVoice ?? 'null'}"`,
    );
    updated += 1;
  }

  if (updated === 0) {
    console.log('[migrate-siliconflow-voice-ids] 未发现需要迁移的助手语音音色');
    return;
  }

  console.log(`[migrate-siliconflow-voice-ids] 迁移完成，共更新 ${updated} 个助手`);
}
