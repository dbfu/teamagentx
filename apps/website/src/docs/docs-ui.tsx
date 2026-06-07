import type { ReactNode } from 'react'

// ── 章节块（标题 + 简介 + 内容） ──
export function DocsSection({
  id,
  title,
  intro,
  children,
}: {
  id?: string
  title: string
  intro?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="docs-section-block">
      <div className="docs-section-head">
        <span className="docs-kicker">Section</span>
        <h2>{title}</h2>
        {intro && <p>{intro}</p>}
      </div>
      <div className="docs-section-body">{children}</div>
    </section>
  )
}

// ── 卡片 ──
export function DocCard({
  title,
  eyebrow,
  children,
}: {
  title: string
  eyebrow?: string
  children: ReactNode
}) {
  return (
    <article className="docs-card">
      {eyebrow && <div className="docs-card-eyebrow">{eyebrow}</div>}
      <h3>{title}</h3>
      <div className="docs-card-content">{children}</div>
    </article>
  )
}

// ── 页面顶部头部 ──
export function ManualHeader({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string
  title: string
  intro: string
}) {
  return (
    <section className="docs-hero docs-article-hero">
      <div className="docs-hero-badge">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{intro}</p>
    </section>
  )
}

// ── 高亮标注框 ──
export function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="docs-callout">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  )
}

// ── 无序列表 ──
export function DocList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="docs-list">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

// ── 步骤列表 ──
export function DocSteps({ steps }: { steps: { title: string; desc: ReactNode }[] }) {
  return (
    <div className="docs-steps">
      {steps.map((step, index) => (
        <div className="docs-step" key={index}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <div>
            <h3>{step.title}</h3>
            <p>{step.desc}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 纵向步骤时间线 ──
export function DocTimeline({ steps }: { steps: { title: string; desc: ReactNode }[] }) {
  return (
    <ol className="docs-timeline">
      {steps.map((step, index) => (
        <li className="docs-timeline-item" key={index}>
          <span className="docs-timeline-marker">{String(index + 1).padStart(2, '0')}</span>
          <div className="docs-timeline-body">
            <h3>{step.title}</h3>
            <p>{step.desc}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

// ── 表格 ──
export function DocTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="docs-table-wrap">
      <table className="docs-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 代码块 ──
export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="docs-code">
      <code>{children}</code>
    </pre>
  )
}

// ── 行内代码 ──
export function Code({ children }: { children: ReactNode }) {
  return <code className="docs-inline-code">{children}</code>
}
