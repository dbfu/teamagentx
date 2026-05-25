export function shouldRenderUncategorizedSection(
  uncategorizedCount: number,
  activeAgentCategoryId: string | null | undefined
) {
  return uncategorizedCount > 0 || activeAgentCategoryId === null
}
