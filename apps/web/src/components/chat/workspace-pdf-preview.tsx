export default function WorkspacePdfPreview({ path, content }: { path: string; content: string }) {
  return (
    <iframe
      title={`PDF 预览：${path}`}
      src={`data:application/pdf;base64,${content}`}
      className="h-full w-full border-0 bg-muted/20"
    />
  )
}
