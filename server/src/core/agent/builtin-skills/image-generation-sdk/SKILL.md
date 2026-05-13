---
name: image-generation-sdk
description: Use when generating images through a generic HTTP/SDK image generation API, including OpenAI-compatible /images/generations endpoints, base64 or URL image responses, async task polling providers, and local file output. This skill is project-agnostic and should be used when the user wants reusable image generation automation without business-specific templates or app coupling.
metadata:
  short-description: Generate images with generic SDK/API providers
---

# Image Generation SDK

Use this skill to generate image files through a provider API while keeping the calling pattern portable across projects. Do not assume any project-specific task model, storage service, route, prompt template, or output directory.

## Boundaries

- Keep all business context outside this skill. The caller provides the prompt, output directory, file naming, and any domain-specific constraints.
- Prefer provider-agnostic environment variables and CLI flags over hard-coded vendor behavior.
- Never embed API keys in generated files, logs, or final answers.
- If image generation fails, return a structured failure and let the caller decide the fallback.

## Quick Start

Set provider credentials:

```bash
export IMAGE_GEN_API_KEY="..."
export IMAGE_GEN_BASE_URL="https://api.example.com/v1"
export IMAGE_GEN_MODEL="image-model-id"
```

Generate one image:

```bash
node path/to/scripts/generate-image.mjs \
  --prompt "A clean product render of a ceramic mug on a white table" \
  --size 1024x1024
```

The script prints JSON only:

```json
{
  "success": true,
  "files": ["artifacts/images/image_001.png"],
  "urls": ["/uploads/images/image_001.png"],
  "provider": "generic/image-model-id"
}
```

## Workflow

1. Gather only portable inputs: prompt, output directory, image count, size or aspect ratio, optional provider mode.
2. Choose the provider mode:
   - `sync` for OpenAI-compatible `POST /images/generations` responses containing `data[].url` or `data[].b64_json`.
   - `async` for providers that return a task id, then expose a task status endpoint.
   - `auto` when the provider can be inferred from the first response.
3. Run `scripts/generate-image.mjs`.
4. Check the JSON result. Treat `success: false` as non-fatal unless the caller explicitly requires images.
5. In TeamAgentX, prefer `urls[]` for the user-facing reply. Return generated images with Markdown image syntax, for example `![生成图片](/uploads/images/image_001.png)`.

## Script Capabilities

`scripts/generate-image.mjs` is dependency-free and requires Node.js 18+ for global `fetch`.

Common flags:

- `--prompt <text>` required
- `--output <dir>` default `./output`
- `--filename <name>` optional stable filename; when generating multiple images, the script appends an index
- `--size <WxH|ratio>` default `1024x1024`
- `--n <number>` default `1`
- `--mode <sync|async|auto>` default `sync`
- `IMAGE_GEN_API_TYPE` can also set the default mode.
- `--timeout-ms <number>` total timeout for the request or async polling
- `--poll-interval-ms <number>` async polling interval
- `--extra-json <json>` merges provider-specific request fields into the submit body

Provider environment variables:

- `IMAGE_GEN_API_KEY` required unless `--api-key` is passed
- `IMAGE_GEN_BASE_URL` default `https://api.openai.com/v1`
- `IMAGE_GEN_MODEL` required unless `--model` is passed
- `IMAGE_GEN_PROVIDER` optional label for logs/result JSON
- `TEAMAGENTX_IMAGE_OUTPUT_DIR` optional default output directory; TeamAgentX sets this to the served upload image directory.
- `TEAMAGENTX_IMAGE_URL_PREFIX` optional URL prefix; TeamAgentX sets this to `/uploads/images`.

Advanced provider flags are documented in [provider-contracts.md](references/provider-contracts.md). Read it when integrating a non-OpenAI-compatible provider or an async task API.

## Portability Rules

- Do not add project routes, task IDs, user tokens, storage SDKs, or queue semantics to this skill.
- Do not add prompt templates for a specific product domain. Keep prompt advice generic.
- Do not assume generated images are for HTML, PPTX, documents, education, marketing, or any other scenario.
- Keep output paths caller-controlled. The script may create the output directory but must not choose a project root.
