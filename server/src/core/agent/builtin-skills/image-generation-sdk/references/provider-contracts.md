# Provider Contracts

This reference describes the generic contracts supported by `scripts/generate-image.mjs`.

## Synchronous Images API

Default request:

```http
POST {IMAGE_GEN_BASE_URL}/images/generations
Authorization: Bearer {IMAGE_GEN_API_KEY}
Content-Type: application/json
```

Default JSON body:

```json
{
  "model": "model-id",
  "prompt": "image prompt",
  "size": "1024x1024",
  "n": 1
}
```

The script accepts any of these response shapes:

```json
{ "data": [{ "url": "https://..." }] }
{ "data": [{ "b64_json": "..." }] }
{ "url": "https://..." }
{ "image": "data:image/png;base64,..." }
{ "images": ["https://..."] }
```

Use `--extra-json` for provider-specific fields such as quality, style, response_format, seed, aspect_ratio, resolution, or safety settings.

## Async Task API

Use `--mode async` when a provider requires task submission and polling.

Defaults:

- Submit: `POST {base}/images/generations`
- Task id extraction: first matching field among `task_id`, `id`, `data.task_id`, `data[0].task_id`
- Poll: `GET {base}/tasks/{task_id}`
- Cancel on timeout: `DELETE {base}/tasks/{task_id}`

Override paths:

```bash
node scripts/generate-image.mjs \
  --mode async \
  --submit-path /images/generations \
  --task-path-template "/tasks/{task_id}" \
  --cancel-path-template "/tasks/{task_id}"
```

The polling response is considered complete when status is one of:

- `completed`
- `succeeded`
- `success`
- `done`

It is considered failed when status is one of:

- `failed`
- `error`
- `cancelled`
- `canceled`

The script extracts image URLs/base64 values from common fields including `data`, `result`, `result.images`, `images`, `output`, `url`, `b64_json`, and data URLs.

## Size and Aspect Ratio

Some providers require pixel sizes (`1024x1024`), while others require aspect ratios (`1:1`). Pass the value expected by the provider in `--size`.

For providers that need both, pass one through `--size` and the other through `--extra-json`:

```bash
node scripts/generate-image.mjs \
  --prompt "..." \
  --size 1:1 \
  --extra-json '{"resolution":"2k"}'
```

## Known Provider Quirks

### apimart (gpt-image-2 / image-2)

- **Submit:** `POST {base}/images/generations`
- **Submit response:** task id is at `data[0].task_id`
- **Poll:** `GET {base}/tasks/{task_id}`
- **Size format:** aspect ratio string, e.g. `"1:1"`, `"16:9"` (not pixels)
- **Completed status value:** `"completed"`
- **Image URL path:** `data.result.images[0].url[0]` — note `url` is an **array**, not a string

Example poll response when complete:
```json
{
  "code": 200,
  "data": {
    "task_id": "task_01KPQ...",
    "status": "completed",
    "result": {
      "images": [{ "url": ["https://cdn.apimart.ai/xxx.png"] }]
    }
  }
}
```

Required config: `mode=async`, `baseUrl=https://api.apimart.ai/v1`, size in ratio format.

## Result JSON

Success:

```json
{
  "success": true,
  "files": ["output/image_001.png"],
  "urls": ["/uploads/images/image_001.png"],
  "provider": "provider/model",
  "mode": "sync"
}
```

Failure:

```json
{
  "success": false,
  "error": "HTTP 401: ...",
  "provider": "provider/model",
  "mode": "sync"
}
```

Consumers should parse JSON from stdout/stderr and avoid scraping human-readable logs. The script intentionally emits only JSON.
