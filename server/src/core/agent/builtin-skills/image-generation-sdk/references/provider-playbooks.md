# Provider Playbooks

This file captures the minimum provider-specific guidance the caller should know before building `size` and `extraJson`.

## OpenAI

- Docs: https://developers.openai.com/api/docs/guides/image-generation
- Default endpoint: `POST /images/generations`
- Best when:
  - you already know the pixel size you want
  - you want `quality`, `background`, `output_format`, or `output_compression`
- Recommended size strategy:
  - translate semantic requests into OpenAI-supported pixel sizes such as `1024x1024`, `1024x1536`, `1536x1024`
  - keep `size` as a pixel string whenever possible
- Common extra fields:
  - `quality`
  - `background`
  - `output_format`
  - `output_compression`

## OpenRouter

- Docs:
  - https://openrouter.ai/docs/guides/overview/multimodal/image-generation
  - https://openrouter.ai/docs/guides/overview/models
- Default endpoint: `POST /chat/completions`
- Best when:
  - the configured model advertises image output in `output_modalities`
  - you want to use `image_config.aspect_ratio` and `image_config.image_size`
- Recommended size strategy:
  - translate semantic requests into `image_config.aspect_ratio`
  - use `image_config.image_size` for `1K` / `2K` / `4K` requests
- Common extra fields:
  - `image_config.aspect_ratio`
  - `image_config.image_size`
  - provider/model-specific options such as `style` or `strength`

## Gemini / Imagen

- Docs:
  - https://ai.google.dev/gemini-api/docs/image-generation
  - https://ai.google.dev/gemini-api/docs/imagen
- Best when:
  - the user describes output intent semantically
  - aspect ratio and output tier matter more than exact pixel values
- Recommended size strategy:
  - prefer ratios like `1:1`, `3:4`, `4:3`, `9:16`, `16:9`
  - add `imageSize` / `image_size` when the user asks for higher resolution
- Common extra fields:
  - `aspectRatio`
  - `imageSize`
  - `personGeneration`

## Zhipu

- Docs:
  - https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image
  - https://docs.bigmodel.cn/api-reference/模型-api/图像生成异步
- Default endpoint:
  - sync: `POST /images/generations`
  - async: `POST /async/images/generations`
- Recommended size strategy:
  - use recommended pixel sizes such as `1280x1280`, `1728x960`, `960x1728`
  - custom width and height must be between `512` and `2048`, both multiples of `32`

## APIMart

- Docs:
  - https://docs.apimart.ai/en/api-reference/images/gpt-image-2/official
  - https://docs.apimart.ai/en/api-reference/images/gpt-image-1/generation
- Default endpoint: `POST /images/generations`
- Best when:
  - the model is async and returns `task_id`
  - the provider separates `size` ratio from `resolution`
- Recommended size strategy:
  - use ratio strings like `1:1`, `2:3`, `9:16`, `16:9`
  - add `resolution` for `1k` / `2k` / `4k`
- Common extra fields:
  - `resolution`
  - `quality`
  - `output_format`
  - `output_compression`
  - `image_urls`
  - `mask_url`

## Bailian / Wanxiang

- Docs:
  - https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference
  - https://help.aliyun.com/zh/model-studio/text-to-image-api-reference
- Default endpoint:
  - sync (wan2.6): `POST /multimodal-generation/generation`
  - async (wan2.6): `POST /image-generation/generation`
- Recommended size strategy:
  - prefer `宽*高` format such as `1280*1280`, `1696*960`, `960*1696`
  - for semantic requests, translate first and then put the actual size in `parameters.size`
- Common extra fields:
  - `negative_prompt`
  - `prompt_extend`
  - `watermark`
  - `seed`

## xAI

- Docs:
  - https://docs.x.ai/developers/model-capabilities/images/generation
  - https://docs.x.ai/developers/models/grok-imagine-image
- Default endpoint: `POST /images/generations`
- Recommended size strategy:
  - do not send `size`; use `aspect_ratio` plus `resolution` in `extraJson`
  - supported resolutions currently include `1k` and `2k`
- Common extra fields:
  - `aspect_ratio`
  - `resolution`
  - `response_format`

## Volcengine Ark / Doubao

- Docs:
  - https://www.volcengine.com/docs/82379/1666945
  - https://www.volcengine.com/docs/6492/2221472
- Recommended usage:
  - prefer Ark API Key + endpoint mode
  - confirm the exact model contract before adding provider-specific fields
- Common extra fields:
  - `response_format`
  - `reference_images`
  - `optimize_prompt_options`
  - `watermark`
