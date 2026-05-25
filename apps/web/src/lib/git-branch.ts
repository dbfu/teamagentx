import type { GitBranchInfo } from './agent-api'

export function filterGitBranches(branches: GitBranchInfo[], query: string): GitBranchInfo[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return branches

  return branches.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery))
}
