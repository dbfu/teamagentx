import http from 'node:http';
import { resolveLanzouDownloadUrl } from './lanzou-resolver.mjs';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT || '3207', 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
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

  sendJson(res, 404, { success: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[download-resolver] listening on http://${HOST}:${PORT}`);
});
