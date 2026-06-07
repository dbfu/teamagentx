// 后台命令执行系统
// 设计参考 Claude Code 的 ShellCommand/TaskOutput 架构

export { TaskOutput } from './task-output.js';
export { ShellCommand, type ShellCommandState, type CommandResult, type ShellCommandOptions, type BlockCallback, ForegroundTimeoutError } from './shell-command.js';
export { detectBlocking, looksLikeInteractivePrompt, getInteractivePatterns, addInteractivePattern, BLOCK_DETECTION_CONFIG, type BlockDetectionResult } from './block-detector.js';
export { backgroundTaskManager } from './background-task-manager.js';
