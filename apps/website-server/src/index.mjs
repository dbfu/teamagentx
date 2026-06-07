import http from 'node:http';
import { config } from 'dotenv';
import { resolveLanzouDownloadUrl } from './lanzou-resolver.mjs';

config();

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT || '3207', 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const FEISHU_OPEN_API_BASE = process.env.FEISHU_OPEN_API_BASE || 'https://open.feishu.cn/open-apis';
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const FEISHU_BITABLE_APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN || '';
const FEISHU_BITABLE_TABLE_ID = process.env.FEISHU_BITABLE_TABLE_ID || '';
const FEISHU_DOWNLOAD_FIELD_TIME = process.env.FEISHU_DOWNLOAD_FIELD_TIME || '时间';
const FEISHU_DOWNLOAD_FIELD_PLATFORM = process.env.FEISHU_DOWNLOAD_FIELD_PLATFORM || '平台';
const FEISHU_DOWNLOAD_FIELD_URL = process.env.FEISHU_DOWNLOAD_FIELD_URL || '下载链接';
const FEISHU_DOWNLOAD_FIELD_PAGE = process.env.FEISHU_DOWNLOAD_FIELD_PAGE || '来源页面';
const FEISHU_DOWNLOAD_FIELD_USER_AGENT = process.env.FEISHU_DOWNLOAD_FIELD_USER_AGENT || 'User Agent';
const FEISHU_DOWNLOAD_FIELD_IP = process.env.FEISHU_DOWNLOAD_FIELD_IP || 'IP';
const FEISHU_DOWNLOAD_FIELD_VERSION = process.env.FEISHU_DOWNLOAD_FIELD_VERSION || '客户端版本';

const TRACKED_PLATFORMS = new Set(['macos-arm64', 'macos-x64', 'windows', 'android']);

let feishuTokenCache = {
  token: '',
  expiresAt: 0,
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Cache-Control': 'no-store',
  });
  res.end();
}

function redirect(res, targetUrl) {
  res.writeHead(302, {
    Location: targetUrl,
    'Cache-Control': 'no-store',
  });
  res.end();
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isFeishuDownloadTrackingEnabled() {
  return Boolean(
    FEISHU_APP_ID &&
    FEISHU_APP_SECRET &&
    FEISHU_BITABLE_APP_TOKEN &&
    FEISHU_BITABLE_TABLE_ID,
  );
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

function toFeishuUrlField(value) {
  if (!isHttpUrl(value)) {
    return null;
  }
  return { link: value, text: value };
}

async function getFeishuTenantAccessToken() {
  const now = Date.now();
  if (feishuTokenCache.token && feishuTokenCache.expiresAt > now + 60_000) {
    return feishuTokenCache.token;
  }

  const response = await fetch(`${FEISHU_OPEN_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    }),
  });
  const payload = await response.json();

  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(`Feishu tenant_access_token failed: ${payload.msg || response.statusText}`);
  }

  feishuTokenCache = {
    token: payload.tenant_access_token,
    expiresAt: now + Math.max(Number(payload.expire || 0) - 120, 60) * 1000,
  };
  return feishuTokenCache.token;
}

async function writeDownloadEventToFeishu(fields) {
  const token = await getFeishuTenantAccessToken();
  const endpoint = `${FEISHU_OPEN_API_BASE}/bitable/v1/apps/${encodeURIComponent(FEISHU_BITABLE_APP_TOKEN)}/tables/${encodeURIComponent(FEISHU_BITABLE_TABLE_ID)}/records`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ fields }),
  });
  const payload = await response.json();

  if (!response.ok || payload.code !== 0) {
    throw new Error(`Feishu bitable record failed: ${payload.msg || response.statusText}`);
  }
}

async function recordDownloadEvent(req, originalUrl, platform, version) {
  if (!TRACKED_PLATFORMS.has(platform) || !isFeishuDownloadTrackingEnabled()) {
    return;
  }

  // 飞书多维表格字段格式：
  // - 时间字段：毫秒时间戳（数字）
  // - URL字段：{ link: "url", text: "显示文本" } 对象格式
  const fields = {
    [FEISHU_DOWNLOAD_FIELD_TIME]: Date.now(),
    [FEISHU_DOWNLOAD_FIELD_PLATFORM]: platform,
    [FEISHU_DOWNLOAD_FIELD_URL]: toFeishuUrlField(originalUrl),
    [FEISHU_DOWNLOAD_FIELD_USER_AGENT]: req.headers['user-agent'] || '',
    [FEISHU_DOWNLOAD_FIELD_IP]: getClientIp(req),
  };
  if (version) {
    fields[FEISHU_DOWNLOAD_FIELD_VERSION] = version;
  }
  const refererField = toFeishuUrlField(req.headers.referer || '');
  if (refererField) {
    fields[FEISHU_DOWNLOAD_FIELD_PAGE] = refererField;
  }

  await writeDownloadEventToFeishu(fields);
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { success: false, error: 'Missing request URL' });
    return;
  }

  if (req.method === 'OPTIONS') {
    sendNoContent(res);
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { success: true, status: 'ok' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/resolve') {
    const originalUrl = url.searchParams.get('url') || '';
    if (!originalUrl) {
      sendJson(res, 400, { success: false, error: 'Missing "url" query parameter' });
      return;
    }

    if (!isHttpUrl(originalUrl)) {
      sendJson(res, 400, { success: false, error: 'Only http/https URLs are supported' });
      return;
    }

    try {
      const resolvedUrl = await resolveLanzouDownloadUrl(originalUrl);
      sendJson(res, 200, {
        success: true,
        originalUrl,
        resolvedUrl,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 502, {
        success: false,
        originalUrl,
        error: message,
      });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/download') {
    const originalUrl = url.searchParams.get('url') || '';
    const platform = url.searchParams.get('platform') || '';
    const version = url.searchParams.get('version') || '';
    if (!originalUrl) {
      sendJson(res, 400, { success: false, error: 'Missing "url" query parameter' });
      return;
    }

    if (!isHttpUrl(originalUrl)) {
      sendJson(res, 400, { success: false, error: 'Only http/https URLs are supported' });
      return;
    }

    recordDownloadEvent(req, originalUrl, platform, version).catch((error) => {
      console.error('[website-server] failed to record download event:', error);
    });

    try {
      const resolvedUrl = await resolveLanzouDownloadUrl(originalUrl);
      redirect(res, resolvedUrl);
    } catch {
      redirect(res, originalUrl);
    }
    return;
  }

  sendJson(res, 404, { success: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[website-server] listening on http://${HOST}:${PORT}`);
});
