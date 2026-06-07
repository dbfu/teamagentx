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
  const modelText = model || '(model not configured)';

  switch (provider) {
    case 'openai':
      return {
        provider,
        displayName: 'OpenAI Images API',
        docs: ['https://developers.openai.com/api/docs/guides/image-generation'],
        summary: `Current model ${modelText} uses /images/generations. Common fields are size, quality, background, and output_format.`,
        sizeGuidance: [
          'Prefer officially supported OpenAI pixel sizes, such as 1024x1024, 1024x1536, and 1536x1024.',
          'If the user only says landscape, portrait, or square, infer an appropriate pixel size before calling the tool.',
        ],
        extraFieldGuidance: [
          'Use extraJson for quality, background, output_format, and output_compression.',
          'gpt-image-2 supports auto/low/medium/high quality and relatively flexible pixel sizes.',
        ],
        examples: [
          'Landscape banner: size=1536x1024',
          'Portrait poster: size=1024x1536, extraJson={"quality":"high"}',
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
        summary: `Current model ${modelText} generates images through /chat/completions. First confirm the model output modalities include image, then choose modalities based on model capability.`,
        sizeGuidance: [
          'Prefer translating semantic sizes into image_config.aspect_ratio, such as 1:1, 9:16, 16:9, or 21:9.',
          'For higher resolution, add 1K/2K/4K in extraJson.image_config.image_size when supported.',
        ],
        extraFieldGuidance: [
          'Gemini-like models usually use modalities=["image","text"]; Flux/Sourceful/Recraft commonly use ["image"].',
          'Use extraJson.image_config for aspect_ratio and image_size. Some models also support fields such as style and strength.',
        ],
        examples: [
          'Portrait cover: extraJson={"image_config":{"aspect_ratio":"9:16","image_size":"2K"}}',
          'Ultra-wide banner: extraJson={"image_config":{"aspect_ratio":"21:9"}}',
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
        summary: `Current model ${modelText} is better controlled with semantic fields such as aspectRatio and imageSize instead of fixed pixel sizes.`,
        sizeGuidance: [
          'Prefer ratios such as 1:1, 3:4, 4:3, 9:16, and 16:9.',
          'For high-resolution requests, combine with imageSize=1K/2K when supported. Not every model supports arbitrary pixel sizes.',
        ],
        extraFieldGuidance: [
          'Use extraJson for aspectRatio / aspect_ratio, imageSize / image_size, and personGeneration.',
          'If the user only describes a portrait poster or landscape cover, infer the aspect ratio first, then decide whether to add imageSize.',
        ],
        examples: [
          'Portrait promo image: size=9:16, extraJson={"imageSize":"2K"}',
          'Square draft: size=1:1, extraJson={"imageSize":"1K"}',
        ],
      };
    case 'zhipu':
      return {
        provider,
        displayName: 'Zhipu GLM Image API',
        docs: [
          'https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image',
          'https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%9B%BE%E5%83%8F%E7%94%9F%E6%88%90%E5%BC%82%E6%AD%A5',
        ],
        summary: `Current model ${modelText} can generate images through the Zhipu image generation API. Pixel sizes are recommended, especially for posters, slides, science explainers, and other text-heavy scenes.`,
        sizeGuidance: [
          'Prefer recommended pixel sizes such as 1280x1280, 1568x1056, 1056x1568, 1728x960, and 960x1728.',
          'If the user only says landscape, portrait, or square, map it to a recommended Zhipu pixel size before calling the tool.',
        ],
        extraFieldGuidance: [
          'GLM-Image mainly uses size pixel strings. Width and height must be between 512 and 2048 and multiples of 32.',
          'For async APIs, reuse the task_id + tasks polling flow.',
        ],
        examples: [
          'Landscape poster: size=1728x960',
          'Portrait cover: size=960x1728',
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
        summary: `Current model ${modelText} usually uses async /images/generations. size commonly uses aspect-ratio strings, while resolution controls 1k/2k/4k separately.`,
        sizeGuidance: [
          'Prefer aspect-ratio size values such as 1:1, 16:9, 9:16, and 2:3. Some models also accept pixel strings.',
          'For poster, wallpaper, or HD banner requests, usually add resolution=2k or 4k.',
        ],
        extraFieldGuidance: [
          'Use extraJson for resolution, quality, output_format, output_compression, image_urls, and mask_url.',
          'GPT-Image-2 Official docs provide clear size x resolution mappings; use them to infer HD output parameters.',
        ],
        examples: [
          'HD landscape poster: size=16:9, extraJson={"resolution":"2k","quality":"high"}',
          '4K wallpaper: size=16:9, extraJson={"resolution":"4k"}',
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
        summary: `For current model ${modelText}, prefer the newer Wanxiang wan2.6 API. Both sync and async modes use Alibaba Bailian's custom request body, not the standard OpenAI Images body.`,
        sizeGuidance: [
          'wan2.6 uses width*height format, such as 1280*1280, 1696*960, and 960*1696.',
          'If the user only says portrait poster or landscape banner, map it to a recommended width*height size.',
        ],
        extraFieldGuidance: [
          'Use extraJson for negative_prompt, prompt_extend, watermark, and seed.',
          'Async mode requires task polling. For wan2.6, prefer /image-generation/generation + X-DashScope-Async.',
        ],
        examples: [
          'Square image: size=1280*1280, extraJson={"watermark":false}',
          'Landscape poster: size=1696*960, extraJson={"prompt_extend":true}',
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
        summary: `Current model ${modelText} uses /images/generations and supports aspect_ratio, resolution, and response_format. Official docs recommend grok-imagine-image-quality.`,
        sizeGuidance: [
          'Prefer translating semantic sizes into aspect_ratio, such as 1:1, 16:9, 9:16, 3:4, and 2:3.',
          'For HD requests, pass 1k or 2k through extraJson.resolution.',
        ],
        extraFieldGuidance: [
          'Use extraJson for aspect_ratio, resolution, and response_format.',
          'xAI returns URLs by default. Use response_format=b64_json for inline base64.',
        ],
        examples: [
          'Landscape header: extraJson={"aspect_ratio":"16:9"}',
          'HD square image: extraJson={"aspect_ratio":"1:1","resolution":"2k"}',
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
        summary: `Current model ${modelText} can connect through Volcengine Ark image generation APIs or Doubao image capabilities. Prefer Ark API key + endpoint configuration, and pass fields such as size and response_format according to the specific model docs.`,
        sizeGuidance: [
          'Different models have different size requirements. Common values are pixel sizes or resolution tiers such as 2K.',
          'If the user only gives a semantic size, translate it into a clear pixel size first, then add resolution fields when supported.',
        ],
        extraFieldGuidance: [
          'Common fields include response_format, reference_images, optimize_prompt_options, and watermark.',
          'Use only fields supported by the selected endpoint/model docs. Do not invent fields.',
        ],
        examples: [
          'Square draft: size=2048x2048',
          'Multi-reference creation: extraJson={"response_format":"url"}',
        ],
      };
    default:
      return {
        provider,
        displayName: 'Generic image provider',
        docs: [],
        summary: `Current model ${modelText} has no provider-specific guide. Prefer size, n, and the smallest possible extraJson.`,
        sizeGuidance: [
          'Prefer explicit pixel sizes or aspect-ratio strings.',
        ],
        extraFieldGuidance: [
          'Pass extra fields only when you are sure this provider supports them.',
        ],
        examples: [
          'Square image: size=1024x1024',
        ],
      };
  }
}
