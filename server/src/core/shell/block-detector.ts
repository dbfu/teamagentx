/**
 * BlockDetector - 检测交互式命令阻塞
 *
 * 设计参考 Claude Code 的 stall watchdog：
 * - 检测输出是否停止增长
 * - 模式匹配常见交互式提示符
 * - 触发通知让用户决定如何处理
 */

// 交互式提示模式
// 参考 Claude Code 的 PROMPT_PATTERNS
const INTERACTIVE_PATTERNS = [
  // 密码输入
  /Password:\s*$/i,
  /password for.*:\s*$/i,
  /Enter passphrase:\s*$/i,

  // 用户名输入
  /Username:\s*$/i,
  /login:\s*$/i,
  /User:\s*$/i,

  // 确认提示
  /\[Y\/n\]\s*$/i,
  /\[y\/N\]\s*$/i,
  /\(Y\/n\)\s*$/i,
  /\(y\/N\)\s*$/i,
  /\[yes\/no\]\s*$/i,
  /\(yes\/no\)\s*$/i,

  // 继续提示
  /Continue\?.*:\s*$/i,
  /Proceed\?.*:\s*$/i,
  /Overwrite\?.*:\s*$/i,
  /Are you sure.*\?\s*$/i,
  /Do you want.*\?\s*$/i,
  /Would you.*\?\s*$/i,
  /Shall I.*\?\s*$/i,

  // 按键继续
  /Press any key/i,
  /Press Enter/i,
  /Hit any key/i,

  // 分页显示
  /---More---/,
  /--More--/,
  /:--/,

  // REPL 提示符
  />\s*$/,
  /\?\s*$/,
  />>>\s*$/,
  /In \[\d+\]:\s*$/,

  // SSH/远程
  /Are you sure you want to continue connecting.*\?\s*$/i,

  // Git
  /Merge branch.*\?\s*$/i,
];

// 阻塞检测配置
export const BLOCK_DETECTION_CONFIG = {
  // 检查间隔（毫秒）
  CHECK_INTERVAL_MS: 5000,

  // 阻塞阈值（毫秒）- 无输出多长时间后认为可能阻塞
  BLOCK_THRESHOLD_MS: 45000,

  // 尾部读取字节数
  TAIL_BYTES: 1024,
};

export interface BlockDetectionResult {
  blocked: boolean;
  reason?: string;
  matchedPattern?: string;
}

/**
 * 检测输出尾部是否匹配交互式提示模式
 */
export function looksLikeInteractivePrompt(tailContent: string): { matched: boolean; pattern?: string } {
  const lastLine = tailContent.trimEnd().split('\n').pop() ?? '';

  for (const pattern of INTERACTIVE_PATTERNS) {
    if (pattern.test(lastLine)) {
      return { matched: true, pattern: pattern.source };
    }
  }

  return { matched: false };
}

/**
 * 检测命令是否阻塞
 *
 * @param lastOutputTime 上次输出时间
 * @param currentSize 当前输出大小
 * @param previousSize 上次检查时的输出大小
 * @param tailContent 输出尾部内容
 * @returns 阻塞检测结果
 */
export function detectBlocking(
  lastOutputTime: Date,
  currentSize: number,
  previousSize: number,
  tailContent: string
): BlockDetectionResult {
  const timeSinceOutput = Date.now() - lastOutputTime.getTime();
  const sizeChanged = currentSize !== previousSize;

  // 输出大小变化 = 没有阻塞
  if (sizeChanged) {
    return { blocked: false };
  }

  // 未达到阻塞阈值 = 不确定
  if (timeSinceOutput < BLOCK_DETECTION_CONFIG.BLOCK_THRESHOLD_MS) {
    return { blocked: false };
  }

  // 检查是否匹配交互式提示模式
  const promptCheck = looksLikeInteractivePrompt(tailContent);

  if (promptCheck.matched) {
    return {
      blocked: true,
      reason: `检测到交互式提示: ${promptCheck.pattern}`,
      matchedPattern: promptCheck.pattern,
    };
  }

  // 没有匹配模式，但长时间无输出
  // 可能是慢速命令或真正阻塞
  return {
    blocked: true,
    reason: `命令已 ${Math.round(timeSinceOutput / 1000)} 秒无输出`,
  };
}

/**
 * 获取所有交互式提示模式
 */
export function getInteractivePatterns(): RegExp[] {
  return [...INTERACTIVE_PATTERNS];
}

/**
 * 添加自定义交互式提示模式
 */
export function addInteractivePattern(pattern: RegExp): void {
  INTERACTIVE_PATTERNS.push(pattern);
}
