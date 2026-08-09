import * as XLSX from 'xlsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const MAX_ROWS = 300
const MAX_COLUMNS = 40

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toLocaleString()
  return String(value)
}

export default function WorkspaceSpreadsheetPreview({ path, content }: { path: string; content: string }) {
  const { t } = useTranslation()
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [activeSheet, setActiveSheet] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const nextWorkbook = XLSX.read(content, { type: 'base64', cellDates: true })
      setWorkbook(nextWorkbook)
      setActiveSheet(nextWorkbook.SheetNames[0] ?? '')
      setError(null)
    } catch (parseError) {
      setWorkbook(null)
      setActiveSheet('')
      setError(parseError instanceof Error ? parseError.message : String(parseError))
    }
  }, [content])

  const rows = useMemo(() => {
    if (!workbook || !activeSheet) return []
    const sheet = workbook.Sheets[activeSheet]
    if (!sheet) return []
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false }) as unknown[][]
  }, [activeSheet, workbook])

  const visibleRows = rows.slice(0, MAX_ROWS)
  const columnCount = Math.min(
    MAX_COLUMNS,
    visibleRows.reduce((max, row) => Math.max(max, row.length), 0),
  )

  if (error) {
    return <div className="grid h-full place-items-center px-6 text-center text-xs text-destructive">{t('chat.workspaceDocumentParseFailed')}</div>
  }

  if (!workbook) {
    return <div className="grid h-full place-items-center text-xs text-muted-foreground">{t('common.loading')}</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card" aria-label={`${t('chat.workspaceSpreadsheetPreview')}：${path}`}>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted/20 px-2 py-1">
        {workbook.SheetNames.map((sheetName) => (
          <button
            key={sheetName}
            type="button"
            className={`shrink-0 rounded px-2.5 py-1 text-[11px] transition-colors ${activeSheet === sheetName ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            onClick={() => setActiveSheet(sheetName)}
          >
            {sheetName}
          </button>
        ))}
      </div>
      {columnCount === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center text-xs text-muted-foreground">{t('chat.workspaceSpreadsheetEmpty')}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="min-w-full border-collapse text-xs">
            <tbody>
              {visibleRows.map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex === 0 ? 'bg-muted/40 font-medium' : undefined}>
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-muted/60 px-2 py-1.5 text-right text-[10px] text-muted-foreground">{rowIndex + 1}</td>
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <td key={columnIndex} className="max-w-[360px] whitespace-pre-wrap border-b border-r border-border px-3 py-1.5 align-top">{formatCell(row[columnIndex])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX_ROWS && <p className="px-3 py-2 text-[11px] text-muted-foreground">{t('chat.workspaceSpreadsheetTruncated', { rows: MAX_ROWS })}</p>}
        </div>
      )}
    </div>
  )
}
