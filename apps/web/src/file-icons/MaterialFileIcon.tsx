import {
  defaultMaterialFileIcon,
  materialFileExtensions,
  materialFileNames,
} from './associations.generated';

const iconModules = import.meta.glob('../assets/material-file-icons/*.svg', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;

const iconUrls = Object.fromEntries(Object.entries(iconModules).map(([assetPath, url]) => {
  const iconId = assetPath.slice(assetPath.lastIndexOf('/') + 1, -'.svg'.length);
  return [iconId, url];
}));

export function getMaterialFileIconId(fileName: string): string {
  const normalizedName = fileName.toLocaleLowerCase('en-US');
  const nameMatch = materialFileNames[normalizedName];
  if (nameMatch) return nameMatch;

  const nameParts = normalizedName.split('.');
  for (let index = 1; index < nameParts.length; index += 1) {
    const extensionMatch = materialFileExtensions[nameParts.slice(index).join('.')];
    if (extensionMatch) return extensionMatch;
  }

  return defaultMaterialFileIcon;
}
export function MaterialFileIcon({ name, className = '' }: { name: string; className?: string }) {
  const iconId = getMaterialFileIconId(name);
  return (
    <img
      src={iconUrls[iconId] ?? iconUrls[defaultMaterialFileIcon]}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`size-4 shrink-0 object-contain ${className}`}
    />
  );
}
