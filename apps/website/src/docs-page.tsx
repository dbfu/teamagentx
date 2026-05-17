import { useEffect, useState, type ReactNode } from 'react'
import type { SiteConfig } from './site-config'

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)

function downloadIcon(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

const GITHUB_URL = 'https://github.com/dbfu/teamagentx'

const sections = [
  { id: 'overview', title: '产品概览' },
  { id: 'quickstart', title: '快速开始' },
  { id: 'workspace', title: '消息与工作区' },
  { id: 'assistants', title: '助手管理' },
  { id: 'models', title: '模型管理' },
  { id: 'skills', title: '技能体系' },
  { id: 'automation', title: '自动化与集成' },
  { id: 'settings', title: '设置与多端连接' },
] as const

interface DocsPageProps {
  siteConfig: SiteConfig
}

function DocsSection({
  id,
  title,
  intro,
  children,
}: {
  id: string
  title: string
  intro: string
  children: ReactNode
}) {
  return (
    <section id={id} className="docs-section-block">
      <div className="docs-section-head">
        <span className="docs-kicker">Section</span>
        <h2>{title}</h2>
        <p>{intro}</p>
      </div>
      <div className="docs-section-body">{children}</div>
    </section>
  )
}

function DocCard({
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

export function DocsPage({ siteConfig }: DocsPageProps) {
  const [showMacModal, setShowMacModal] = useState(false)
  const [selectedArch, setSelectedArch] = useState<'arm64' | 'x64'>('arm64')
  const [detectedArch, setDetectedArch] = useState<'arm64' | 'x64' | null>(null)

  useEffect(() => {
    if (!IS_MAC) return
    const uad = (navigator as { userAgentData?: { getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string }> } }).userAgentData
    const resolve = (arch: 'arm64' | 'x64') => { setDetectedArch(arch); setSelectedArch(arch) }
    if (uad?.getHighEntropyValues) {
      uad.getHighEntropyValues(['architecture'])
        .then((hints) => resolve(hints.architecture === 'arm' ? 'arm64' : 'x64'))
        .catch(() => resolve('arm64'))
    } else {
      resolve('arm64')
    }
  }, [])

  return (
    <div className="page-shell docs-shell">
      <div className="grid-bg" />

      <header className="top-nav docs-top-nav">
        <a className="nav-logo" href="/" aria-label="TeamAgentX Home">
          <img src="/app-logo.png" alt="TeamAgentX" width={28} height={28} />
          <span>TeamAgentX</span>
        </a>
        <nav className="nav-links docs-nav-links">
          <a href="/">产品首页</a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="#quickstart">快速开始</a>
          <a href="#automation">自动化</a>
        </nav>
        <div className="nav-actions">
          <a href="#quickstart" className="btn btn-outline">开始使用</a>
          <a href="#download" className="btn btn-primary">下载客户端</a>
        </div>
      </header>

      <main className="docs-layout">
        <aside className="docs-sidebar">
          <div className="docs-sidebar-card">
            <div className="docs-sidebar-label">使用文档</div>
            <h1>TeamAgentX 文档中心</h1>
            <p>基于客户端现有功能整理，覆盖首次配置、日常使用和自动化协作。</p>
          </div>

          <nav className="docs-toc">
            {sections.map((section, index) => (
              <a key={section.id} href={`#${section.id}`}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{section.title}</strong>
              </a>
            ))}
          </nav>
        </aside>

        <div className="docs-main">
          <section className="docs-hero">
            <div className="docs-hero-badge">官方文档</div>
            <h1>把 TeamAgentX 当作一套可运营的 AI 协作工作台来使用</h1>
            <p>
              TeamAgentX 不是单个聊天机器人，而是一套围绕“模型配置、助手管理、群组协作、技能安装、自动化调度、外部平台接入”展开的多 Agent 工作台。
              文档内容基于客户端功能代码整理，重点说明每个模块能做什么、入口在哪里、适合怎么用。
            </p>
            <div className="docs-hero-actions">
              <a href="#quickstart" className="btn btn-primary">阅读快速开始</a>
              <a href="#download" className="btn btn-outline">下载客户端</a>
            </div>
          </section>

          <div className="docs-summary-grid">
            <div>
              <strong>多模型接入</strong>
              <span>文本、图片、语音、视频模型统一配置</span>
            </div>
            <div>
              <strong>多助手协作</strong>
              <span>群聊中 @ 指派，助手并行执行与接力回复</span>
            </div>
            <div>
              <strong>自动化运行</strong>
              <span>Cron、间隔、一次性任务都可落地</span>
            </div>
          </div>

          <DocsSection
            id="overview"
            title="产品概览"
            intro="先理解 TeamAgentX 的基本工作方式，再进入具体模块，会更容易建立正确的使用心智。"
          >
            <div className="docs-grid docs-grid-2">
              <DocCard title="核心工作模型" eyebrow="How it works">
                <ul className="docs-list">
                  <li>先在“模型”里配置可用的 LLM / 图片 / 语音模型。</li>
                  <li>再在“助手”里创建不同职责的 Agent，分别设定提示词、运行方式、模型供应商和附加能力。</li>
                  <li>最后把助手放进群聊，让它们围绕同一任务共同工作。</li>
                </ul>
              </DocCard>
              <DocCard title="适合什么场景" eyebrow="Best for">
                <ul className="docs-list">
                  <li>需要多人分工式 AI 协作的任务，例如调研、写作、开发、审核和报表生成。</li>
                  <li>需要固定流程自动运行的任务，例如日报、巡检、定期摘要和外部平台消息处理。</li>
                  <li>希望把本地 CLI / SDK 能力与大模型工作流放进统一工作台的场景。</li>
                </ul>
              </DocCard>
            </div>
            <div className="docs-callout">
              <strong>建议的使用顺序</strong>
              <p>先配置模型，再创建助手，然后建群聊并开始对话；技能、定时任务和外部平台集成适合在基础流程跑通后逐步引入。</p>
            </div>
          </DocsSection>

          <DocsSection
            id="quickstart"
            title="快速开始"
            intro="第一次使用时，先跑完初始化，再完成一个最小可用的协作闭环。"
          >
            <div className="docs-steps">
              <div className="docs-step">
                <span>01</span>
                <div>
                  <h3>完成初始化向导</h3>
                  <p>首次进入会看到欢迎页、工具检测、管理员账户创建和完成页。桌面端可以直接检测本地 AI 工具，并在向导中完成安装。</p>
                </div>
              </div>
              <div className="docs-step">
                <span>02</span>
                <div>
                  <h3>添加至少一个模型供应商</h3>
                  <p>进入“模型”，新增文本模型；如需图片或语音能力，再补充对应类型模型。建议先指定一个默认文本模型，后续 AI 解析和助手创建更顺畅。</p>
                </div>
              </div>
              <div className="docs-step">
                <span>03</span>
                <div>
                  <h3>创建 1 到 3 个助手</h3>
                  <p>进入“助手”，为每个 Agent 填写名称、提示词、运行方式和模型绑定。起步阶段建议至少准备一个主执行助手和一个审阅助手。</p>
                </div>
              </div>
              <div className="docs-step">
                <span>04</span>
                <div>
                  <h3>创建群聊并开始任务</h3>
                  <p>新建群组，把助手加入同一房间，直接在消息区下达任务。日常简单任务也可以用“与某助手快速对话”，它会创建临时会话。</p>
                </div>
              </div>
            </div>
          </DocsSection>

          <DocsSection
            id="workspace"
            title="消息与工作区"
            intro="消息页是 TeamAgentX 的日常主界面，群聊、快速对话、任务看板和房间操作都从这里展开。"
          >
            <div className="docs-grid docs-grid-2">
              <DocCard title="群聊与快速对话" eyebrow="入口：消息">
                <ul className="docs-list">
                  <li>普通群聊适合多助手协作，一个房间里可以同时挂多个 Agent。</li>
                  <li>快速对话适合与单个助手临时沟通，支持为本次会话单独指定工作目录。</li>
                  <li>如果快速对话不填写工作目录，系统会按默认策略创建独立会话目录。</li>
                </ul>
              </DocCard>
              <DocCard title="房间级操作" eyebrow="顶部工具栏">
                <ul className="docs-list">
                  <li>查看群成员、添加助手、打开或复制群工作目录。</li>
                  <li>打开任务看板，集中查看正在执行的任务。</li>
                  <li>停止所有任务、查看群规则、创建定时任务、清空消息、截图聊天记录。</li>
                </ul>
              </DocCard>
            </div>
            <DocCard title="推荐使用方式" eyebrow="Practical tips">
              <ul className="docs-list">
                <li>把房间当作“项目空间”使用，一个房间聚焦一个主题或项目阶段。</li>
                <li>在群规则里明确输出格式、协作顺序和禁止事项，能显著提升多助手配合稳定性。</li>
                <li>需要保留上下文的长期任务使用固定群聊，需要一次性实验的任务使用快速对话。</li>
              </ul>
            </DocCard>
          </DocsSection>

          <DocsSection
            id="assistants"
            title="助手管理"
            intro="助手页决定了你的 AI 团队如何分工。这里不仅是创建入口，也是能力编排和持续维护的中心。"
          >
            <div className="docs-grid docs-grid-2">
              <DocCard title="创建与组织助手" eyebrow="入口：助手">
                <ul className="docs-list">
                  <li>支持创建分类、为助手分组，并通过拖拽调整顺序。</li>
                  <li>创建时可设置名称、头像、描述、分类和核心提示词。</li>
                  <li>已有助手可以编辑、复制、启停、删除，也可以直接发起快速对话。</li>
                </ul>
              </DocCard>
              <DocCard title="运行方式与模型绑定" eyebrow="Assistant runtime">
                <ul className="docs-list">
                  <li>助手可选择本地 Agent 运行方式，并按工具类型决定使用本地配置或显式绑定模型供应商。</li>
                  <li>Codex 助手支持额外选择本地默认模型或指定 Codex 模型。</li>
                  <li>需要代理时可在助手级填写代理配置，避免影响其他助手。</li>
                </ul>
              </DocCard>
              <DocCard title="扩展能力" eyebrow="Capabilities">
                <ul className="docs-list">
                  <li>可为助手开启图片生成能力，但开启后必须绑定一个已创建的图片模型。</li>
                  <li>可安装技能，让助手具备稳定的操作模板和领域能力。</li>
                  <li>助手详情页支持语音设置，包含开关、播报方式、内置语音风格和试听。</li>
                </ul>
              </DocCard>
              <DocCard title="提示词维护建议" eyebrow="Prompting">
                <ul className="docs-list">
                  <li>将职责边界、输入要求、输出格式和协作规则写进提示词。</li>
                  <li>主执行助手和审阅助手的提示词不要相同，否则容易出现重复劳动。</li>
                  <li>复杂提示词可以先草拟，再使用内置优化流程迭代。</li>
                </ul>
              </DocCard>
            </div>
            <DocCard title="如何为熟手助手启用生图" eyebrow="Image generation">
              <ul className="docs-list">
                <li>先进入“模型”，新增一个模型类型为“图片”的供应商配置，并确保状态为“已启用”。</li>
                <li>再进入“助手”的创建或编辑弹框，打开“图片生成能力”开关。</li>
                <li>开关打开后，从下拉框里选择一个图片模型；如果列表为空，说明当前还没有可用图片模型。</li>
                <li>系统会校验图片能力只能绑定图片模型，不能误绑到文本模型。</li>
              </ul>
            </DocCard>
          </DocsSection>

          <DocsSection
            id="models"
            title="模型管理"
            intro="模型页负责把不同供应商的能力纳入统一配置中心，是整个系统的底层资源层。"
          >
            <div className="docs-grid docs-grid-2">
              <DocCard title="支持的模型类型" eyebrow="Model types">
                <ul className="docs-list">
                  <li>文本模型：用于大部分聊天、助手执行、提示词解析。</li>
                  <li>图片模型：用于启用图片生成能力的助手。</li>
                  <li>语音模型：用于语音播报相关能力。</li>
                  <li>视频模型：为后续多模态扩展预留统一入口。</li>
                </ul>
              </DocCard>
              <DocCard title="配置方式" eyebrow="Provider setup">
                <ul className="docs-list">
                  <li>每个模型供应商都包含名称、协议、API 地址、API Key、模型 ID、启用状态和默认状态。</li>
                  <li>文本模型支持按协议组织；图片模型会根据供应商自动带出推荐 API 地址与提交路径。</li>
                  <li>支持复制已有配置，适合在同一供应商下维护多个模型版本。</li>
                </ul>
              </DocCard>
            </div>
            <DocCard title="图片模型配置流程" eyebrow="Image providers">
              <ul className="docs-list">
                <li>在“模型”里点击新增，将“模型类型”切换为“图片”。</li>
                <li>选择图片供应商、调用方式，填写 base URL、API Key 和模型 ID。</li>
                <li>图片模型要求填写完整的 `imageProvider` 和 `imageApiType`，否则无法保存为可用配置。</li>
                <li>状态需要是“已启用”，后续助手侧的图片能力下拉框才会出现该模型。</li>
              </ul>
            </DocCard>
            <div className="docs-grid docs-grid-2">
              <DocCard title="当前支持的图片供应商" eyebrow="Supported now">
                <ul className="docs-list">
                  <li>OpenAI</li>
                  <li>APIMart</li>
                  <li>OpenRouter</li>
                  <li>Gemini</li>
                  <li>Zhipu</li>
                  <li>Bailian</li>
                  <li>xAI</li>
                  <li>Volcengine Ark</li>
                  <li>Custom</li>
                </ul>
              </DocCard>
              <DocCard title="调用方式说明" eyebrow="API mode">
                <ul className="docs-list">
                  <li>`sync`：同步返回图片结果，适合兼容 OpenAI `POST /images/generations` 的接口。</li>
                  <li>`async`：先返回任务 ID，再由系统轮询任务结果，适合异步出图供应商。</li>
                  <li>`auto`：由系统按供应商特征自动识别，更适合已经清楚接口能力的熟手使用。</li>
                  <li>系统只要求填写 base URL，真实提交路径会根据供应商和调用方式自动拼接。</li>
                </ul>
              </DocCard>
            </div>
            <div className="docs-grid docs-grid-2">
              <DocCard title="供应商差异提示" eyebrow="Provider notes">
                <ul className="docs-list">
                  <li>OpenRouter 需要填写真正支持图片输出的模型 ID，不能使用普通文本模型。</li>
                  <li>Bailian 在同步模式下走 `multimodal-generation/generation`，异步模式走 `image-generation/generation`。</li>
                  <li>Zhipu 推荐直接填写图片模型 ID，例如 `glm-image`。</li>
                  <li>xAI 当前推荐新请求使用 `grok-imagine-image-quality`。</li>
                </ul>
              </DocCard>
              <DocCard title="给熟手的启用建议" eyebrow="For advanced users">
                <ul className="docs-list">
                  <li>如果你已经明确目标供应商的协议，优先按供应商类型建模，不要一开始就走 `custom`。</li>
                  <li>先完成模型配置并测试连通性，再去助手里启用图片能力，排错链路会更短。</li>
                  <li>一个助手只绑定一个图片模型最容易维护；要试不同风格，建议复制出多个图片模型配置。</li>
                  <li>把出图职责交给专门助手，比在所有通用助手上都开启图片能力更容易控质量和成本。</li>
                </ul>
              </DocCard>
            </div>
            <DocCard title="运维建议" eyebrow="Operations">
              <ul className="docs-list">
                <li>至少保留一个默认且启用中的文本模型，便于新助手创建和 AI 辅助解析。</li>
                <li>模型太多时，可按文本 / 图片 / 语音 / 视频筛选，也可通过名称、模型 ID、API 地址搜索。</li>
                <li>在正式投入前先做连接测试，避免把错误延后到助手执行阶段。</li>
              </ul>
            </DocCard>
          </DocsSection>

          <DocsSection
            id="skills"
            title="技能体系"
            intro="技能页适合沉淀可复用能力，把一次性提示词或流程固化成可安装资产。"
          >
            <div className="docs-grid docs-grid-2">
              <DocCard title="共享技能与安装" eyebrow="入口：技能">
                <ul className="docs-list">
                  <li>共享技能列表支持搜索、查看说明、查看已安装到哪些助手。</li>
                  <li>可以将某个技能批量安装到多个助手，也可以统一调整安装范围。</li>
                  <li>用户创建技能与外部导入技能会在来源上区分，便于后续治理。</li>
                </ul>
              </DocCard>
              <DocCard title="导入外部技能" eyebrow="Import modes">
                <ul className="docs-list">
                  <li>客户端可以扫描外部技能目录，并按工具来源分组展示。</li>
                  <li>支持“符号链接”导入，适合希望跟随外部目录更新的团队。</li>
                  <li>支持“完整复制”导入，适合希望独立维护、避免外部变更影响的场景。</li>
                </ul>
              </DocCard>
            </div>
            <div className="docs-callout">
              <strong>技能使用建议</strong>
              <p>把高频且有固定步骤的任务做成技能，例如代码评审、行业调研、文档生成；不要把一次性临时说明全部塞进技能，否则后续难维护。</p>
            </div>
          </DocsSection>

          <DocsSection
            id="automation"
            title="自动化与集成"
            intro="当日常协作跑顺后，可以把 TeamAgentX 推进到“自动运行”阶段，让它定时执行并连接外部平台。"
          >
            <div className="docs-grid docs-grid-2">
              <DocCard title="定时任务" eyebrow="入口：消息 > 房间顶部时钟">
                <ul className="docs-list">
                  <li>支持三种调度类型：Cron 表达式、固定间隔、一次性执行。</li>
                  <li>可填写任务名称、描述、执行内容、最大重试次数，并指定全部助手或部分助手执行。</li>
                  <li>任务卡片会展示下次执行时间、上次执行时间、最近错误，并支持测试执行、查看历史、启停和编辑。</li>
                </ul>
              </DocCard>
              <DocCard title="外部平台集成" eyebrow="入口：集成">
                <ul className="docs-list">
                  <li>按平台维护机器人实例，录入平台字段后可直接绑定到群聊。</li>
                  <li>支持启停机器人、修改凭证、重绑房间、删除实例。</li>
                  <li>需要公网回调的平台可以单独保存公网地址，并复制对应 webhook 地址。</li>
                </ul>
              </DocCard>
            </div>
            <DocCard title="自动化设计建议" eyebrow="Design tips">
              <ul className="docs-list">
                <li>先在群聊里手动跑通任务，再把稳定版本迁移成定时任务。</li>
                <li>绑定外部平台前，先明确哪个房间负责接收、哪个助手负责处理，避免消息进入错误上下文。</li>
                <li>对外部机器人使用独立房间更清晰，便于隔离历史和排查执行记录。</li>
              </ul>
            </DocCard>
          </DocsSection>

          <DocsSection
            id="settings"
            title="设置与多端连接"
            intro="设置页既负责个人偏好，也承担桌面能力检测、移动端接入和客户端更新等运维型功能。"
          >
            <div className="docs-grid docs-grid-2">
              <DocCard title="个人与界面设置" eyebrow="Settings">
                <ul className="docs-list">
                  <li>可修改用户名和头像，并即时预览结果。</li>
                  <li>支持浅色、深色、跟随系统三种主题模式，以及多套品牌配色。</li>
                  <li>可开启或关闭消息提示音。</li>
                </ul>
              </DocCard>
              <DocCard title="桌面端工具与更新" eyebrow="Desktop">
                <ul className="docs-list">
                  <li>桌面端可检测 Claude / Codex 等本地工具的 CLI 与 SDK 状态，并触发 SDK 安装。</li>
                  <li>当本地 SDK 已安装时，相关助手会优先走 SDK；否则继续使用 CLI。</li>
                  <li>设置页支持检查客户端更新，并显示当前版本。</li>
                </ul>
              </DocCard>
              <DocCard title="移动端连接" eyebrow="Mobile">
                <ul className="docs-list">
                  <li>桌面端可生成二维码，让手机 App 自动登录并连接到当前服务地址。</li>
                  <li>如果机器有多个局域网地址，可以手动切换，适配不同网络环境。</li>
                  <li>也可以直接打开带登录参数的网页地址，方便在浏览器里快速验证。</li>
                </ul>
              </DocCard>
              <DocCard title="何时需要来设置页" eyebrow="When to use">
                <ul className="docs-list">
                  <li>刚完成安装，需要补充个人资料或调整视觉风格时。</li>
                  <li>桌面端工具不可用，需要检查本地运行方式时。</li>
                  <li>准备把当前工作台扩展到手机端或检查新版本时。</li>
                </ul>
              </DocCard>
            </div>
          </DocsSection>

          <section id="download" className="docs-download">
            <div>
              <div className="docs-kicker">Next step</div>
              <h2>开始搭建你的第一个 AI 协作空间</h2>
              <p>建议先下载客户端，完成初始化后创建一个“调研 + 撰写 + 审核”的三助手群聊，这是验证 TeamAgentX 价值最快的方式。</p>
            </div>
            <div className="docs-download-actions">
              <button type="button" className="btn btn-primary" onClick={() => setShowMacModal(true)}>
                {downloadIcon(14)} 下载 macOS 客户端
              </button>
              <a href={siteConfig.winUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                下载 Windows 客户端
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                查看 GitHub
              </a>
            </div>
            <p className="download-note">当前版本 {siteConfig.version} · 文档内容基于客户端功能实现整理</p>
          </section>
        </div>
      </main>

      {/* ── macOS 芯片选择弹窗 ── */}
      {showMacModal && (
        <div className="mac-modal-overlay" onClick={() => setShowMacModal(false)}>
          <div className="mac-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mac-modal-close" onClick={() => setShowMacModal(false)}>×</button>
            <div className="mac-modal-header">
              <h3>选择 macOS 安装包</h3>
              <p>请根据你的 Mac 芯片类型选择对应版本</p>
            </div>
            <div className="mac-modal-options">
              <button
                type="button"
                className={`mac-modal-option${selectedArch === 'arm64' ? ' selected' : ''}`}
                onClick={() => setSelectedArch('arm64')}
              >
                <div className="mac-modal-option-body">
                  <div className="mac-modal-option-title">Apple Silicon</div>
                  <div className="mac-modal-option-desc">M1 · M2 · M3 · M4 及更新芯片</div>
                </div>
                {detectedArch === 'arm64' && <span className="mac-modal-badge">当前设备</span>}
              </button>
              <button
                type="button"
                className={`mac-modal-option${selectedArch === 'x64' ? ' selected' : ''}`}
                onClick={() => setSelectedArch('x64')}
              >
                <div className="mac-modal-option-body">
                  <div className="mac-modal-option-title">Intel</div>
                  <div className="mac-modal-option-desc">Intel Core 系列处理器</div>
                </div>
                {detectedArch === 'x64' && <span className="mac-modal-badge">当前设备</span>}
              </button>
            </div>
            <a
              href={selectedArch === 'arm64' ? siteConfig.macUrlArm64 : siteConfig.macUrlX64}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary mac-modal-download-btn"
              onClick={() => setShowMacModal(false)}
            >
              {downloadIcon(15)} 下载 {selectedArch === 'arm64' ? 'Apple Silicon' : 'Intel'} 版本
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
