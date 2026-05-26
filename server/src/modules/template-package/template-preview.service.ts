import {
  type CapabilityDescriptor,
  type LocalCapabilityProvider,
  mapCapabilityDescriptors,
} from './capability-mapper.js';
import {
  detectTemplateConflicts,
  type ExistingTemplateImport,
} from './conflict-detector.js';
import {
  parseTemplateManifest,
} from './template-manifest.js';
import type { DegradedTemplateSkill } from './template-skill-packager.js';

interface PreviewTemplatePackageInput {
  manifestInput: unknown;
  desiredGroupName: string;
  existingImports: ExistingTemplateImport[];
  existingGroupNames: string[];
  capabilityDescriptors: CapabilityDescriptor[];
  degradedSkills?: DegradedTemplateSkill[];
  localProviders: LocalCapabilityProvider[];
}

export function previewTemplatePackage(input: PreviewTemplatePackageInput) {
  const manifest = parseTemplateManifest(input.manifestInput);
  const conflicts = detectTemplateConflicts({
    templateId: manifest.templateId,
    version: manifest.version,
    desiredGroupName: input.desiredGroupName,
    existingImports: input.existingImports,
    existingGroupNames: input.existingGroupNames,
  });

  const compatibility = mapCapabilityDescriptors(
    input.capabilityDescriptors,
    input.localProviders,
  );

  return {
    manifest,
    summary: {
      groupName: manifest.title,
      agents: manifest.contents.agents,
      categories: manifest.contents.categories,
      skills: manifest.contents.skills,
      cronTasks: manifest.contents.cronTasks,
    },
    conflicts,
    compatibility,
    degradedSkills: input.degradedSkills ?? [],
  };
}
