import type { LlmProvider } from './llm-provider-api'

export function getRequiredProviderProtocol(
  assistantType: 'builtin' | 'acp',
  acpTool: string
): LlmProvider['apiProtocol'] | null {
  if (assistantType !== 'acp') return null
  if (acpTool === 'claude') return 'anthropic'
  if (acpTool === 'codex') return 'openai'
  return null
}

export function isProviderCompatibleWithAgent(
  provider: LlmProvider,
  assistantType: 'builtin' | 'acp',
  acpTool: string
): boolean {
  const requiredProtocol = getRequiredProviderProtocol(assistantType, acpTool)
  return !requiredProtocol || provider.apiProtocol === requiredProtocol
}

export function getProviderProtocolHint(
  assistantType: 'builtin' | 'acp',
  acpTool: string
): string {
  const requiredProtocol = getRequiredProviderProtocol(assistantType, acpTool)
  if (requiredProtocol === 'anthropic') {
    return '可不选择供应商，直接使用本地 Claude 配置；如需自定义供应商，仅支持 anthropic 协议'
  }
  if (requiredProtocol === 'openai') {
    return '可不选择供应商，直接使用本地 Codex auth.json；如需自定义供应商，仅支持 openai 协议'
  }
  if (assistantType === 'acp') {
    return '该 ACP 工具暂不支持自定义 LLM 供应商'
  }
  return '选择供应商或使用默认供应商'
}
