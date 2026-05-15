export interface ImageProviderProfile {
  provider: string;
  displayName: string;
  docs: string[];
  summary: string;
  sizeGuidance: string[];
  extraFieldGuidance: string[];
  examples: string[];
}

export interface NormalizedImageRequestParams {
  size?: string;
  extraJson: Record<string, unknown>;
}

const DEFAULT_PROVIDER = 'custom';

const RATIO_ALIASES: Array<{ pattern: RegExp; ratio: string }> = [
  { pattern: /^(square|avatar|icon|方图|正方形)$/i, ratio: '1:1' },
  { pattern: /^(poster|海报)$/i, ratio: '2:3' },
  { pattern: /^(portrait|vertical|story|mobile|竖版|长图|封面)$/i, ratio: '9:16' },
  { pattern: /^(landscape|horizontal|hero|banner|横版|横图)$/i, ratio: '16:9' },
  { pattern: /^(panorama|wide|ultra-wide|全景|超宽)$/i, ratio: '21:9' },
];

const OPENAI_RATIO_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
  '3:4': '1024x1536',
  '4:3': '1536x1024',
  '4:5': '1024x1536',
  '5:4': '1536x1024',
  '9:16': '1024x1536',
  '16:9': '1536x1024',
  '21:9': '1536x1024',
};

const GEMINI_ASPECT_RATIOS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9']);
const ZHIPU_RATIO_TO_SIZE: Record<string, string> = {
  '1:1': '1280x1280',
  '3:4': '1088x1472',
  '4:3': '1472x1088',
  '9:16': '960x1728',
  '16:9': '1728x960',
};
const BAILIAN_RATIO_TO_SIZE: Record<string, string> = {
  '1:1': '1280*1280',
  '3:4': '1104*1472',
  '4:3': '1472*1104',
  '9:16': '960*1696',
  '16:9': '1696*960',
};

function cloneExtraJson(extraJson: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(extraJson || {}));
}

function normalizeProviderType(providerType: string | null | undefined): string {
  return (providerType || DEFAULT_PROVIDER).trim().toLowerCase();
}

function parsePixelSize(value: string): { width: number; height: number } | null {
  const match = /^\s*(\d{2,5})\s*x\s*(\d{2,5})\s*$/i.exec(value);
  if (!match) return null;

  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  return { width, height };
}

function ratioFromSize(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;

  if (/^\d+:\d+$/.test(raw)) return raw;

  const pixels = parsePixelSize(raw);
  if (pixels) {
    const { width, height } = pixels;
    const candidates = [
      '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
    ];
    let bestRatio: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const actual = width / height;
    for (const ratio of candidates) {
      const [rw, rh] = ratio.split(':').map(Number);
      const candidate = rw / rh;
      const distance = Math.abs(actual - candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestRatio = ratio;
      }
    }
    return bestDistance <= 0.12 ? bestRatio : null;
  }

  for (const alias of RATIO_ALIASES) {
    if (alias.pattern.test(raw)) return alias.ratio;
  }

  return null;
}

function inferImageTier(value: string): '0.5K' | '1K' | '2K' | '4K' | null {
  const raw = value.trim();
  if (!raw) return null;

  const normalized = raw.toUpperCase();
  if (normalized === '0.5K' || normalized === '1K' || normalized === '2K' || normalized === '4K') {
    return normalized as '0.5K' | '1K' | '2K' | '4K';
  }

  const pixels = parsePixelSize(raw);
  if (!pixels) return null;

  const maxEdge = Math.max(pixels.width, pixels.height);
  if (maxEdge >= 3000) return '4K';
  if (maxEdge >= 1700) return '2K';
  if (maxEdge < 900) return '0.5K';
  return '1K';
}

function normalizeOpenRouterParams(size: string | undefined, extraJson: Record<string, unknown>): NormalizedImageRequestParams {
  const result = cloneExtraJson(extraJson);
  const ratio = size ? ratioFromSize(size) : null;
  const tier = size ? inferImageTier(size) : null;
  const imageConfig = (result.image_config && typeof result.image_config === 'object' && !Array.isArray(result.image_config))
    ? { ...(result.image_config as Record<string, unknown>) }
    : {};

  if (ratio && imageConfig.aspect_ratio === undefined) {
    imageConfig.aspect_ratio = ratio;
  }

  if (tier && imageConfig.image_size === undefined && tier !== '0.5K') {
    imageConfig.image_size = tier;
  }

  if (Object.keys(imageConfig).length > 0) {
    result.image_config = imageConfig;
  }

  return { size, extraJson: result };
}

function normalizeOpenAiParams(size: string | undefined, extraJson: Record<string, unknown>): NormalizedImageRequestParams {
  const result = cloneExtraJson(extraJson);
  if (!size) return { size, extraJson: result };

  const normalizedSize = OPENAI_RATIO_TO_SIZE[ratioFromSize(size) || ''] || size;
  return { size: normalizedSize, extraJson: result };
}

function normalizeGeminiParams(size: string | undefined, extraJson: Record<string, unknown>): NormalizedImageRequestParams {
  const result = cloneExtraJson(extraJson);
  if (!size) return { size, extraJson: result };

  const ratio = ratioFromSize(size);
  const tier = inferImageTier(size);
  if (ratio && GEMINI_ASPECT_RATIOS.has(ratio)) {
    if (result.aspectRatio === undefined) result.aspectRatio = ratio;
    if (result.aspect_ratio === undefined) result.aspect_ratio = ratio;
  }
  if (tier && tier !== '0.5K') {
    if (result.imageSize === undefined) result.imageSize = tier;
    if (result.image_size === undefined) result.image_size = tier;
  }

  return { size: ratio && GEMINI_ASPECT_RATIOS.has(ratio) ? ratio : size, extraJson: result };
}

function normalizeApiMartParams(size: string | undefined, extraJson: Record<string, unknown>): NormalizedImageRequestParams {
  const result = cloneExtraJson(extraJson);
  if (!size) return { size, extraJson: result };

  const ratio = ratioFromSize(size);
  const pixels = parsePixelSize(size);
  const tier = inferImageTier(size);
  if (result.resolution === undefined && tier) {
    result.resolution = tier.toLowerCase();
  }

  if (pixels) {
    return { size, extraJson: result };
  }

  return { size: ratio || size, extraJson: result };
}

function normalizeZhipuParams(size: string | undefined, extraJson: Record<string, unknown>): NormalizedImageRequestParams {
  const result = cloneExtraJson(extraJson);
  if (!size) return { size, extraJson: result };
  const ratio = ratioFromSize(size);
  const normalizedSize = ratio ? (ZHIPU_RATIO_TO_SIZE[ratio] || size) : size;
  return { size: normalizedSize, extraJson: result };
}

function normalizeBailianParams(size: string | undefined, extraJson: Record<string, unknown>): NormalizedImageRequestParams {
  const result = cloneExtraJson(extraJson);
  if (!size) return { size: '1280*1280', extraJson: result };

  const ratio = ratioFromSize(size);
  const pixels = parsePixelSize(size);
  if (pixels) {
    return { size: `${pixels.width}*${pixels.height}`, extraJson: result };
  }

  return { size: ratio ? (BAILIAN_RATIO_TO_SIZE[ratio] || size) : size, extraJson: result };
}

function normalizeXaiParams(size: string | undefined, extraJson: Record<string, unknown>): NormalizedImageRequestParams {
  const result = cloneExtraJson(extraJson);
  if (!size) return { size, extraJson: result };

  const ratio = ratioFromSize(size);
  const tier = inferImageTier(size);
  if (ratio && result.aspect_ratio === undefined) {
    result.aspect_ratio = ratio;
  }
  if (tier && result.resolution === undefined && tier !== '0.5K' && tier !== '4K') {
    result.resolution = tier.toLowerCase();
  }

  return { size, extraJson: result };
}

function normalizeVolcengineParams(size: string | undefined, extraJson: Record<string, unknown>): NormalizedImageRequestParams {
  const result = cloneExtraJson(extraJson);
  return { size, extraJson: result };
}

export function normalizeImageRequestParams(
  providerType: string | null | undefined,
  size: string | undefined,
  extraJson: Record<string, unknown>,
): NormalizedImageRequestParams {
  const normalizedProvider = normalizeProviderType(providerType);
  switch (normalizedProvider) {
    case 'openrouter':
      return normalizeOpenRouterParams(size, extraJson);
    case 'openai':
      return normalizeOpenAiParams(size, extraJson);
    case 'gemini':
      return normalizeGeminiParams(size, extraJson);
    case 'zhipu':
      return normalizeZhipuParams(size, extraJson);
    case 'apimart':
      return normalizeApiMartParams(size, extraJson);
    case 'bailian':
      return normalizeBailianParams(size, extraJson);
    case 'xai':
      return normalizeXaiParams(size, extraJson);
    case 'volcengine':
      return normalizeVolcengineParams(size, extraJson);
    default:
      return { size, extraJson: cloneExtraJson(extraJson) };
  }
}

export function getImageProviderProfile(
  providerType: string | null | undefined,
  model: string | null | undefined,
): ImageProviderProfile {
  const provider = normalizeProviderType(providerType);
  const modelText = model || '(未配置模型)';

  switch (provider) {
    case 'openai':
      return {
        provider,
        displayName: 'OpenAI Images API',
        docs: ['https://developers.openai.com/api/docs/guides/image-generation'],
        summary: `当前模型 ${modelText} 走 /images/generations，常用字段是 size、quality、background、output_format。`,
        sizeGuidance: [
          '优先使用 OpenAI 官方支持的像素尺寸，例如 1024x1024、1024x1536、1536x1024。',
          '如果用户只说“横版/竖版/方图”，先推断成合适的像素尺寸再调用。',
        ],
        extraFieldGuidance: [
          '可通过 extraJson 传 quality、background、output_format、output_compression。',
          'gpt-image-2 支持 auto/low/medium/high 质量和较灵活的像素尺寸。',
        ],
        examples: [
          '横版 banner: size=1536x1024',
          '竖版海报: size=1024x1536, extraJson={"quality":"high"}',
        ],
      };
    case 'openrouter':
      return {
        provider,
        displayName: 'OpenRouter Chat Completions',
        docs: [
          'https://openrouter.ai/docs/guides/overview/multimodal/image-generation',
          'https://openrouter.ai/docs/guides/overview/models',
        ],
        summary: `当前模型 ${modelText} 通过 /chat/completions 生成图片。先确认模型 output modalities 包含 image，再根据模型能力选择 modalities。`,
        sizeGuidance: [
          '优先把语义尺寸转成 image_config.aspect_ratio，例如 1:1、9:16、16:9、21:9。',
          '需要更高分辨率时，再在 extraJson.image_config.image_size 里补 1K/2K/4K。',
        ],
        extraFieldGuidance: [
          'Gemini 类模型通常用 modalities=["image","text"]；Flux/Sourceful/Recraft 常见为 ["image"]。',
          '可通过 extraJson.image_config 传 aspect_ratio、image_size，部分模型还支持 style、strength 等字段。',
        ],
        examples: [
          '竖版封面: extraJson={"image_config":{"aspect_ratio":"9:16","image_size":"2K"}}',
          '超宽横幅: extraJson={"image_config":{"aspect_ratio":"21:9"}}',
        ],
      };
    case 'gemini':
      return {
        provider,
        displayName: 'Gemini / Imagen',
        docs: [
          'https://ai.google.dev/gemini-api/docs/image-generation',
          'https://ai.google.dev/gemini-api/docs/imagen',
        ],
        summary: `当前模型 ${modelText} 更适合用 aspectRatio 和 imageSize 这类语义字段表达尺寸，而不是死记像素。`,
        sizeGuidance: [
          '优先使用 1:1、3:4、4:3、9:16、16:9 这些比例。',
          '高分辨率需求可配合 imageSize=1K/2K；并非所有模型都支持任意像素尺寸。',
        ],
        extraFieldGuidance: [
          '可通过 extraJson 传 aspectRatio / aspect_ratio、imageSize / image_size、personGeneration。',
          '如果用户只描述“竖版海报”“横版封面”，先推断比例，再决定是否补 imageSize。',
        ],
        examples: [
          '竖版宣传图: size=9:16, extraJson={"imageSize":"2K"}',
          '方图草稿: size=1:1, extraJson={"imageSize":"1K"}',
        ],
      };
    case 'zhipu':
      return {
        provider,
        displayName: 'Zhipu GLM Image API',
        docs: [
          'https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image',
          'https://docs.bigmodel.cn/api-reference/模型-api/图像生成异步',
        ],
        summary: `当前模型 ${modelText} 可通过智谱图片生成接口直接生成图片，推荐传像素尺寸，适合海报、PPT、科普图等文字密集场景。`,
        sizeGuidance: [
          '优先使用推荐像素尺寸，如 1280x1280、1568x1056、1056x1568、1728x960、960x1728。',
          '如果用户只说“横版/竖版/方图”，先映射到智谱推荐像素尺寸，再调用。',
        ],
        extraFieldGuidance: [
          'GLM-Image 以 size 像素字符串为主，长宽需在 512-2048 间且为 32 的整数倍。',
          '若走异步接口，可复用 task_id + tasks 查询流程。',
        ],
        examples: [
          '横版海报: size=1728x960',
          '竖版封面: size=960x1728',
        ],
      };
    case 'apimart':
      return {
        provider,
        displayName: 'APIMart Images API',
        docs: [
          'https://docs.apimart.ai/en/api-reference/images/gpt-image-2/official',
          'https://docs.apimart.ai/en/api-reference/images/gpt-image-1/generation',
        ],
        summary: `当前模型 ${modelText} 通常走异步 /images/generations，size 常用比例字符串，resolution 单独控制 1k/2k/4k。`,
        sizeGuidance: [
          '优先使用比例 size，例如 1:1、16:9、9:16、2:3；部分模型也接受像素字符串。',
          '当用户描述“海报/壁纸/高清 banner”时，通常要额外给 resolution=2k 或 4k。',
        ],
        extraFieldGuidance: [
          '可通过 extraJson 传 resolution、quality、output_format、output_compression、image_urls、mask_url。',
          'GPT-Image-2 Official 文档给了明确的 size × resolution 映射，可据此推断高清输出参数。',
        ],
        examples: [
          '高清横版海报: size=16:9, extraJson={"resolution":"2k","quality":"high"}',
          '4K 壁纸: size=16:9, extraJson={"resolution":"4k"}',
        ],
      };
    case 'bailian':
      return {
        provider,
        displayName: 'Alibaba Bailian / Wanxiang',
        docs: [
          'https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference',
          'https://help.aliyun.com/zh/model-studio/text-to-image-api-reference',
        ],
        summary: `当前模型 ${modelText} 建议优先使用万相 wan2.6 的新版接口；同步与异步都走阿里百炼自定义消息体，不是标准 OpenAI Images body。`,
        sizeGuidance: [
          'wan2.6 使用 宽*高 格式，例如 1280*1280、1696*960、960*1696。',
          '如果用户只说“竖版海报”“横版 banner”，先映射为推荐的宽*高尺寸。',
        ],
        extraFieldGuidance: [
          '可通过 extraJson 传 negative_prompt、prompt_extend、watermark、seed。',
          '异步模式需要任务轮询；wan2.6 推荐使用 /image-generation/generation + X-DashScope-Async。',
        ],
        examples: [
          '方图: size=1280*1280, extraJson={"watermark":false}',
          '横版海报: size=1696*960, extraJson={"prompt_extend":true}',
        ],
      };
    case 'xai':
      return {
        provider,
        displayName: 'xAI Imagine Images',
        docs: [
          'https://docs.x.ai/developers/model-capabilities/images/generation',
          'https://docs.x.ai/developers/models/grok-imagine-image',
        ],
        summary: `当前模型 ${modelText} 走 /images/generations，支持 aspect_ratio、resolution、response_format，官方推荐使用 grok-imagine-image-quality。`,
        sizeGuidance: [
          '优先把语义尺寸翻译成 aspect_ratio，例如 1:1、16:9、9:16、3:4、2:3。',
          '高清需求可通过 extraJson.resolution 传 1k 或 2k。',
        ],
        extraFieldGuidance: [
          '可通过 extraJson 传 aspect_ratio、resolution、response_format。',
          'xAI 默认返回 URL；如果要内联 base64，可使用 response_format=b64_json。',
        ],
        examples: [
          '横版头图: extraJson={"aspect_ratio":"16:9"}',
          '高清方图: extraJson={"aspect_ratio":"1:1","resolution":"2k"}',
        ],
      };
    case 'volcengine':
      return {
        provider,
        displayName: 'Volcengine Ark / Doubao Images',
        docs: [
          'https://www.volcengine.com/docs/82379/1666945',
          'https://www.volcengine.com/docs/6492/2221472',
        ],
        summary: `当前模型 ${modelText} 可通过火山方舟图片生成 API 或豆包图像能力接入。建议优先使用方舟的 API Key + endpoint 方式，并按具体模型文档传 size、response_format 等字段。`,
        sizeGuidance: [
          '不同模型对 size 的要求不同，常见是像素尺寸或 2K 这类分辨率档位。',
          '如果用户只给语义尺寸，先转成清晰的像素尺寸，再视模型支持情况补充分辨率字段。',
        ],
        extraFieldGuidance: [
          '常见字段包括 response_format、reference_images、optimize_prompt_options、watermark。',
          '实际可用字段以所选 endpoint/model 文档为准，不要臆造。',
        ],
        examples: [
          '方图草稿: size=2048x2048',
          '多参考创作: extraJson={"response_format":"url"}',
        ],
      };
    default:
      return {
        provider,
        displayName: 'Generic image provider',
        docs: [],
        summary: `当前模型 ${modelText} 没有专门的供应商手册，优先使用 size、n 和最少量的 extraJson。`,
        sizeGuidance: [
          '优先传明确的像素尺寸或比例字符串。',
        ],
        extraFieldGuidance: [
          '只有在你确定该供应商支持时，才传额外字段。',
        ],
        examples: [
          '方图: size=1024x1024',
        ],
      };
  }
}
