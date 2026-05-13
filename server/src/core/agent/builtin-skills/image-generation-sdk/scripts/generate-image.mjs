#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_SIZE = "1024x1024";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_POLL_INTERVAL_MS = 15000;

class CliError extends Error {}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new CliError(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function readConfig(args) {
  const prompt = args.prompt;
  const apiKey = args["api-key"] || process.env.IMAGE_GEN_API_KEY;
  const baseUrl = (args["base-url"] || process.env.IMAGE_GEN_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = args.model || process.env.IMAGE_GEN_MODEL;
  const provider = args.provider || process.env.IMAGE_GEN_PROVIDER || "generic";
  const mode = args.mode || process.env.IMAGE_GEN_API_TYPE || "sync";

  if (!prompt) throw new CliError("--prompt is required");
  if (!apiKey) throw new CliError("IMAGE_GEN_API_KEY or --api-key is required");
  if (!model) throw new CliError("IMAGE_GEN_MODEL or --model is required");
  if (!["sync", "async", "auto"].includes(mode)) {
    throw new CliError("--mode must be sync, async, or auto");
  }

  return {
    prompt,
    apiKey,
    baseUrl,
    model,
    provider,
    mode,
    outputDir: args.output || process.env.TEAMAGENTX_IMAGE_OUTPUT_DIR || "./output",
    filename: args.filename || "",
    size: args.size || DEFAULT_SIZE,
    n: parsePositiveInt(args.n || "1", "--n"),
    timeoutMs: parsePositiveInt(args["timeout-ms"] || String(DEFAULT_TIMEOUT_MS), "--timeout-ms"),
    pollIntervalMs: parsePositiveInt(args["poll-interval-ms"] || String(DEFAULT_POLL_INTERVAL_MS), "--poll-interval-ms"),
    submitPath: args["submit-path"] || "/images/generations",
    taskPathTemplate: args["task-path-template"] || "/tasks/{task_id}",
    cancelPathTemplate: args["cancel-path-template"] || "/tasks/{task_id}",
    extraJson: parseExtraJson(args["extra-json"]),
  };
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseExtraJson(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected object");
    }
    return parsed;
  } catch (error) {
    throw new CliError(`--extra-json must be a JSON object: ${error.message}`);
  }
}

function jsonResult(payload, exitCode) {
  const stream = payload.success ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(exitCode);
}

function buildUrl(baseUrl, suffix) {
  if (/^https?:\/\//i.test(suffix)) return suffix;
  return `${baseUrl}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`HTTP ${response.status}: ${(detail || "").slice(0, 500)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function submitSync(config) {
  const body = {
    model: config.model,
    prompt: config.prompt,
    size: config.size,
    n: config.n,
    ...config.extraJson,
  };
  const data = await fetchJson(buildUrl(config.baseUrl, config.submitPath), {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify(body),
  }, config.timeoutMs);
  return extractImages(data);
}

async function submitAsync(config) {
  const startedAt = Date.now();
  const body = {
    model: config.model,
    prompt: config.prompt,
    size: config.size,
    n: config.n,
    ...config.extraJson,
  };
  const submitData = await fetchJson(buildUrl(config.baseUrl, config.submitPath), {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify(body),
  }, Math.min(config.timeoutMs, 30000));

  const taskId = extractTaskId(submitData);
  if (!taskId) {
    if (config.mode === "auto") return extractImages(submitData);
    throw new Error(`No task id found in async submit response: ${JSON.stringify(submitData).slice(0, 500)}`);
  }

  try {
    return await pollTask(config, taskId, Math.max(config.timeoutMs - (Date.now() - startedAt), 1000));
  } catch (error) {
    await cancelTask(config, taskId);
    throw error;
  }
}

function authHeaders(config) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${config.apiKey}`,
  };
}

async function pollTask(config, taskId, budgetMs) {
  const deadline = Date.now() + budgetMs;
  const taskPath = config.taskPathTemplate.replaceAll("{task_id}", encodeURIComponent(taskId));
  while (Date.now() < deadline) {
    const data = await fetchJson(buildUrl(config.baseUrl, taskPath), {
      method: "GET",
      headers: { authorization: `Bearer ${config.apiKey}` },
    }, Math.min(config.pollIntervalMs, 10000));

    const status = findStatus(data);
    if (["completed", "succeeded", "success", "done"].includes(status)) {
      const images = extractImages(data);
      if (images.length > 0) return images;
      throw new Error(`Task completed but no image was found: ${JSON.stringify(data).slice(0, 500)}`);
    }
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(`Task failed: ${JSON.stringify(data).slice(0, 500)}`);
    }

    await sleep(config.pollIntervalMs);
  }
  throw new Error(`Async task timed out after ${budgetMs}ms`);
}

async function cancelTask(config, taskId) {
  if (!config.cancelPathTemplate) return;
  const cancelPath = config.cancelPathTemplate.replaceAll("{task_id}", encodeURIComponent(taskId));
  try {
    await fetchJson(buildUrl(config.baseUrl, cancelPath), {
      method: "DELETE",
      headers: { authorization: `Bearer ${config.apiKey}` },
    }, 10000);
  } catch {
    // Cancellation is best-effort and should not hide the original failure.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTaskId(value) {
  const candidates = [];
  walk(value, (node, key) => {
    if (["task_id", "taskId", "id"].includes(key) && typeof node === "string") {
      candidates.push(node);
    }
  });
  return candidates[0] || "";
}

function findStatus(value) {
  const statuses = [];
  walk(value, (node, key) => {
    if (key === "status" && typeof node === "string") {
      statuses.push(node.toLowerCase());
    }
  });
  return statuses[0] || "";
}

function extractImages(value) {
  const images = [];
  walk(value, (node, key) => {
    if (typeof node !== "string") return;
    if (key === "b64_json") {
      images.push({ kind: "base64", value: node });
    } else if (key === "url" && (isHttpUrl(node) || isDataImage(node))) {
      images.push(isDataImage(node) ? dataUrlToImage(node) : { kind: "url", value: node });
    } else if (isDataImage(node)) {
      images.push(dataUrlToImage(node));
    }
  });

  if (Array.isArray(value?.images)) {
    for (const item of value.images) {
      if (typeof item === "string" && isHttpUrl(item)) images.push({ kind: "url", value: item });
    }
  }

  return dedupeImages(images);
}

function walk(value, visit, key = "") {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      visit(child, childKey);
      walk(child, visit, childKey);
    }
  }
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function isDataImage(value) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function dataUrlToImage(value) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(value);
  return { kind: "base64", value: match?.[2] || "", mimeType: match?.[1] || "image/png" };
}

function dedupeImages(images) {
  const seen = new Set();
  return images.filter((image) => {
    const key = `${image.kind}:${image.value.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function materializeImages(config, images) {
  if (images.length === 0) {
    throw new Error("No image URL or base64 content found in response");
  }

  await mkdir(config.outputDir, { recursive: true });
  const count = Math.min(images.length, config.n);
  const files = [];

  for (let i = 0; i < count; i += 1) {
    const image = images[i];
    const buffer = image.kind === "url"
      ? await downloadImage(image.value, config.timeoutMs)
      : Buffer.from(image.value, "base64");

    if (buffer.length === 0) throw new Error("Generated image payload is empty");

    const filePath = path.join(config.outputDir, outputName(config.filename, i, count, image.mimeType));
    await writeFile(filePath, buffer);
    files.push(filePath);
  }

  return files;
}

function outputUrls(config, files) {
  const prefix = process.env.TEAMAGENTX_IMAGE_URL_PREFIX;
  if (!prefix) return [];

  return files.map((file) => {
    const basename = path.basename(file);
    return `${prefix.replace(/\/+$/, "")}/${encodeURIComponent(basename)}`;
  });
}

async function downloadImage(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Image download failed HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function outputName(filename, index, count, mimeType = "image/png") {
  const ext = extensionFromMime(mimeType);
  if (!filename) return `image_${String(index + 1).padStart(3, "0")}${ext}`;
  const parsed = path.parse(filename);
  if (count <= 1) return parsed.ext ? filename : `${filename}${ext}`;
  const suffix = `_${String(index + 1).padStart(3, "0")}`;
  return `${parsed.name}${suffix}${parsed.ext || ext}`;
}

function extensionFromMime(mimeType) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".png";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = readConfig(args);
  const providerLabel = `${config.provider}/${config.model}`;

  try {
    const images = config.mode === "async" || config.mode === "auto"
      ? await submitAsync(config)
      : await submitSync(config);
    const files = await materializeImages(config, images);
    jsonResult({
      success: true,
      files,
      urls: outputUrls(config, files),
      provider: providerLabel,
      mode: config.mode,
    }, 0);
  } catch (error) {
    jsonResult({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      provider: providerLabel,
      mode: config.mode,
    }, 1);
  }
}

main().catch((error) => {
  jsonResult({ success: false, error: error instanceof Error ? error.message : String(error) }, 1);
});
