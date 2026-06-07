import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { shanghaiDateKey } from './agent-diary.js';

/**
 * 助手「候选记忆」暂存层。
 *
 * 日记不再每天把模型自由生成的记忆直接灌进长期记忆文件，而是先落到这里的候选池：
 * 每条候选记录它在「哪些不同日期」被观察到（去重），只有在足够多个不同日期复现、
 * 证明它是「频繁出现 / 跨多日仍有价值」的信息后，才会晋升为长期记忆。
 * 长期未再出现的候选会被 TTL 清理掉，避免一次性临时信息长期堆积。
 */

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function getAgentMemoryCandidatesFile(
  agentId: string | null | undefined,
  agentName: string,
): string {
  const agentKey = sanitizePathSegment(agentId || agentName || 'unknown');
  return path.join(os.homedir(), '.teamagentx', 'agents', agentKey, 'memory-candidates.json');
}

/** 候选类别：lesson=错误/教训（出现一次即可晋升），general=普通信息（需跨多日复现） */
export type MemoryCandidateKind = 'lesson' | 'general';

export interface MemoryCandidate {
  id: string;
  text: string;
  kind: MemoryCandidateKind;
  /** 被观察到的不同日期（YYYY-MM-DD），升序去重 */
  days: string[];
  firstSeen: string;
  lastSeen: string;
  promoted: boolean;
  promotedAt: string | null;
}

interface CandidateStore {
  candidates: MemoryCandidate[];
}

/** 今天的对话里观察到的一条记忆信号 */
export interface MemoryObservation {
  /** 命中的已有候选编号（如 "c1"），表示今天再次印证了它；新信息则为 null */
  ref: string | null;
  kind: MemoryCandidateKind;
  text: string;
}

export interface PromotionResult {
  /** 本次新晋升为长期记忆的候选 */
  promoted: MemoryCandidate[];
}

function readStore(file: string): CandidateStore {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.candidates)) {
      return parsed as CandidateStore;
    }
  } catch {
    // 文件不存在或损坏：当作空池
  }
  return { candidates: [] };
}

function writeStore(file: string, store: CandidateStore): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf-8');
}

/** 文本归一化，用于无 ref 时的兜底去重（大小写、空白、常见标点不敏感） */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s，。、；;,.!！?？"'`*\-_]/g, '')
    .trim();
}

/** 把日期 key 往前推 n 天，返回 Asia/Shanghai 日期 key */
function shiftDateKey(dateKey: string, days: number): string {
  const base = new Date(`${dateKey}T00:00:00+08:00`);
  return shanghaiDateKey(new Date(base.getTime() - days * 24 * 60 * 60 * 1000));
}

/** 返回当前候选池（含已晋升与未晋升），主要供生成 prompt 时展示给模型参考 */
export function loadCandidates(
  agentId: string | null | undefined,
  agentName: string,
): MemoryCandidate[] {
  return readStore(getAgentMemoryCandidatesFile(agentId, agentName)).candidates;
}

/**
 * 把今天观察到的记忆信号并入候选池，并执行晋升与 TTL 清理。
 *
 * - 命中已有候选（按 ref 编号，或兜底按归一化文本）→ 把今天加入它的观察日期集合；
 * - 全新信息 → 新建候选；
 * - 候选在不同日期出现次数达到 promoteMinDays → 晋升（写长期记忆由调用方负责）；
 * - 未晋升候选 lastSeen 超过 ttlDays → 丢弃。
 *
 * @param refMap ref 编号（c1/c2…）到候选 id 的映射，与本次 prompt 中展示给模型的编号一致。
 */
export function recordAndPromote(
  agentId: string | null | undefined,
  agentName: string,
  dateKey: string,
  observations: MemoryObservation[],
  refMap: Map<string, string>,
  opts: { promoteMinDays: number; lessonPromoteMinDays: number; ttlDays: number },
): PromotionResult {
  const file = getAgentMemoryCandidatesFile(agentId, agentName);
  const store = readStore(file);
  const byId = new Map(store.candidates.map((c) => [c.id, c]));

  const touch = (cand: MemoryCandidate) => {
    if (!cand.days.includes(dateKey)) {
      cand.days.push(dateKey);
      cand.days.sort();
      cand.firstSeen = cand.days[0];
      cand.lastSeen = cand.days[cand.days.length - 1];
    }
  };

  for (const obs of observations) {
    const text = obs.text.trim();
    if (!text) continue;

    // 1) 优先按模型给出的 ref 编号命中已有候选
    let cand: MemoryCandidate | undefined;
    if (obs.ref) {
      const id = refMap.get(obs.ref);
      if (id) cand = byId.get(id);
    }
    // 2) 兜底：按归一化文本命中（防止模型把旧条目当成新的重复提交）
    if (!cand) {
      const key = normalizeText(text);
      cand = store.candidates.find((c) => normalizeText(c.text) === key);
    }

    if (cand) {
      touch(cand);
      // 普通候选若今天被识别为教训，升级类别，让它享受更低的晋升门槛
      if (obs.kind === 'lesson') cand.kind = 'lesson';
    } else {
      const created: MemoryCandidate = {
        id: randomUUID(),
        text,
        kind: obs.kind === 'lesson' ? 'lesson' : 'general',
        days: [dateKey],
        firstSeen: dateKey,
        lastSeen: dateKey,
        promoted: false,
        promotedAt: null,
      };
      store.candidates.push(created);
      byId.set(created.id, created);
    }
  }

  // 晋升：达到对应类别门槛且尚未晋升的候选。
  // 教训类用 lessonPromoteMinDays（默认 1，出现一次即沉淀），其余用 promoteMinDays。
  const promoted: MemoryCandidate[] = [];
  for (const cand of store.candidates) {
    const threshold = cand.kind === 'lesson' ? opts.lessonPromoteMinDays : opts.promoteMinDays;
    if (!cand.promoted && cand.days.length >= threshold) {
      cand.promoted = true;
      cand.promotedAt = dateKey;
      promoted.push(cand);
    }
  }

  // TTL 清理：未晋升且太久没再出现的候选丢弃（已晋升的保留以便去重）
  const cutoff = shiftDateKey(dateKey, opts.ttlDays);
  store.candidates = store.candidates.filter((c) => c.promoted || c.lastSeen >= cutoff);

  writeStore(file, store);
  return { promoted };
}
