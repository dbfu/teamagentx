/**
 * 构建 Agent/CLI/MCP 子进程可继承的宿主环境。
 *
 * Electron 内置后端会把自己的监听端口写入通用的 PORT（当前为 11053）。
 * 这个值只属于 TeamAgentX 后端；若继续传给第三方 MCP，使用 PORT 的 MCP
 * 会误以为自己也必须监听 11053，最终与宿主后端发生端口冲突。
 */
export function sanitizeAgentChildEnv(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) result[key] = value;
  }

  delete result.PORT;
  return result;
}
