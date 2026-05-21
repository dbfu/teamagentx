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
    const matchedProvider = providers.find((provider) =>
      matchesDescriptor(descriptor, provider),
    );

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
