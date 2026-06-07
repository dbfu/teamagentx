export type TemplateCapabilityType = 'text' | 'image' | 'audio';
export type TemplateProviderProtocol = 'anthropic' | 'openai' | 'custom';
export type TemplateModelType = 'text' | 'image' | 'audio';

export interface CapabilityDescriptor {
  agentRef: string;
  capabilityType: TemplateCapabilityType;
  required: boolean;
  tool?: 'claude' | 'codex' | null;
  providerProtocol?: TemplateProviderProtocol | null;
  modelType: TemplateModelType;
}

export interface LocalCapabilityProvider {
  id: string;
  name: string;
  modelType: TemplateModelType;
  apiProtocol: TemplateProviderProtocol;
  isDefault?: boolean;
}

export interface CapabilityResolution {
  agentRef: string;
  capabilityType: TemplateCapabilityType;
  providerId: string;
  providerName: string;
}

export interface UnresolvedCapabilityResolution {
  agentRef: string;
  capabilityType: TemplateCapabilityType;
  status: 'requires_user_selection' | 'unsupported_but_importable';
}

export interface CapabilityMappingResult {
  resolved: CapabilityResolution[];
  unresolved: UnresolvedCapabilityResolution[];
}

export type AcpToolId = 'claude' | 'codex';

/**
 * 根据本地已安装的 ACP 工具，解析模版助手实际应使用的工具。
 * 若模版选择的工具未安装，而另一个 ACP 工具已安装，则回退到已安装的工具
 * （例如模版选 codex 但本地只装了 claude，则回退为 claude）。
 */
export function resolveEffectiveAcpTool(
  originalTool: string | null,
  installedToolIds: string[],
): string | null {
  if (originalTool !== 'claude' && originalTool !== 'codex') {
    return originalTool;
  }
  if (installedToolIds.includes(originalTool)) {
    return originalTool;
  }
  const fallback: AcpToolId = originalTool === 'codex' ? 'claude' : 'codex';
  if (installedToolIds.includes(fallback)) {
    return fallback;
  }
  return originalTool;
}

/**
 * 在能力映射前，根据已安装工具改写 text 能力描述符的 tool / providerProtocol，
 * 使其与回退后的实际工具一致，从而匹配到对应协议（如 claude → anthropic）的供应商。
 */
export function applyInstalledToolFallback(
  descriptors: CapabilityDescriptor[],
  installedToolIds: string[],
): CapabilityDescriptor[] {
  return descriptors.map((descriptor) => {
    if (
      descriptor.capabilityType !== 'text' ||
      (descriptor.tool !== 'claude' && descriptor.tool !== 'codex')
    ) {
      return descriptor;
    }

    const effective = resolveEffectiveAcpTool(descriptor.tool, installedToolIds);
    if (effective === descriptor.tool) {
      return descriptor;
    }

    return {
      ...descriptor,
      tool: effective as AcpToolId,
      providerProtocol: effective === 'claude' ? 'anthropic' : 'openai',
    };
  });
}

function matchesDescriptor(
  descriptor: CapabilityDescriptor,
  provider: LocalCapabilityProvider,
): boolean {
  if (provider.modelType !== descriptor.modelType) {
    return false;
  }

  if (descriptor.providerProtocol && provider.apiProtocol !== descriptor.providerProtocol) {
    return false;
  }

  if (descriptor.capabilityType === 'text' && descriptor.tool === 'claude') {
    return provider.apiProtocol === 'anthropic';
  }

  if (descriptor.capabilityType === 'text' && descriptor.tool === 'codex') {
    return provider.apiProtocol === 'openai';
  }

  return true;
}

export function mapCapabilityDescriptors(
  descriptors: CapabilityDescriptor[],
  providers: LocalCapabilityProvider[],
): CapabilityMappingResult {
  const resolved: CapabilityResolution[] = [];
  const unresolved: UnresolvedCapabilityResolution[] = [];

  for (const descriptor of descriptors) {
    const matchingProviders = providers.filter((provider) =>
      matchesDescriptor(descriptor, provider),
    );
    // 优先绑定默认模型供应商，没有默认时回退到第一个匹配项
    const matchedProvider =
      matchingProviders.find((provider) => provider.isDefault) ??
      matchingProviders[0];

    if (matchedProvider) {
      resolved.push({
        agentRef: descriptor.agentRef,
        capabilityType: descriptor.capabilityType,
        providerId: matchedProvider.id,
        providerName: matchedProvider.name,
      });
      continue;
    }

    unresolved.push({
      agentRef: descriptor.agentRef,
      capabilityType: descriptor.capabilityType,
      status: descriptor.required
        ? 'requires_user_selection'
        : 'unsupported_but_importable',
    });
  }

  return { resolved, unresolved };
}
