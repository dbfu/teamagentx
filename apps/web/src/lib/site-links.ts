export const TEAMAGENTX_WEBSITE_URL = 'https://www.teamagentx.com'
export const TEAMAGENTX_DOCS_URL = `${TEAMAGENTX_WEBSITE_URL}/docs`
export const TEAMAGENTX_GITHUB_URL = 'https://github.com/dbfu/teamagentx'

export async function openExternalUrl(url: string): Promise<{ success: boolean; error?: string }> {
  if (window.electronAPI?.openExternal) {
    return window.electronAPI.openExternal(url)
  }

  window.open(url, '_blank', 'noopener,noreferrer')
  return { success: true }
}
