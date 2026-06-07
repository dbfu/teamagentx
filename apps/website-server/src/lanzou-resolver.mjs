import http from 'node:http';
import https from 'node:https';
import vm from 'node:vm';
import zlib from 'node:zlib';

const LANZOU_SHARE_HOST_RE = /(^|\.)lanzou[a-z]*\.com$/i;
const MAX_REDIRECTS = 5;

function decodeHtmlAttribute(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function getAttribute(tag, name) {
  const quoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  if (quoted) return decodeHtmlAttribute(quoted[2]);

  const unquoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i'));
  return unquoted ? decodeHtmlAttribute(unquoted[1]) : null;
}

function findLanzouIframeSrc(html) {
  const iframeTags = html.match(/<iframe\b[^>]*>/gi) || [];

  for (const tag of iframeTags) {
    const src = getAttribute(tag, 'src');
    if (!src) continue;

    const className = getAttribute(tag, 'class') || '';
    if (/\bn_downlink\b/i.test(className) || /^\/?fn\b/i.test(src) || src.includes('/fn?')) {
      return src;
    }
  }

  return null;
}

function findDownloadHref(html) {
  const anchorTags = html.match(/<a\b[^>]*>/gi) || [];
  const preferred = anchorTags.find((tag) => {
    const href = getAttribute(tag, 'href') || '';
    return /(^https?:\/\/|\/)file\//i.test(href) || /lanrar\.com|lanzou[a-z]*\.com/i.test(href);
  });
  if (preferred) {
    return getAttribute(preferred, 'href');
  }

  for (const tag of anchorTags) {
    const href = getAttribute(tag, 'href');
    if (href && !href.startsWith('#') && !href.toLowerCase().startsWith('javascript:')) {
      return href;
    }
  }

  return null;
}

function findWpSign(html) {
  const match = html.match(/\bwp_sign\s*=\s*['"]([^'"]+)['"]/i);
  return match?.[1] || null;
}

function findAjaxmPath(html) {
  const matches = Array.from(html.matchAll(/(?:['"]?\/?)?(ajaxm\.php\?file=\d+)/gi)).map((match) => match[1]);
  if (matches.length === 0) return null;
  return matches[1] || matches[0];
}

function normalizeProtocolUrl(url) {
  return url.startsWith('//') ? `https:${url}` : url;
}

function parseAjaxDownloadUrl(jsonText) {
  let response;
  try {
    response = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!response || typeof response !== 'object') return null;
  const data = response;
  if (data.zt !== 1 && data.zt !== '1') return null;

  const dom = typeof data.dom === 'string' ? data.dom : '';
  const url = typeof data.url === 'string' ? data.url : '';
  if (!dom || !url || url === '0') return null;

  return `${normalizeProtocolUrl(dom).replace(/\/$/, '')}/file/${url.replace(/^\//, '')}`;
}

function extractCookiePair(cookie) {
  const firstPart = cookie.split(';')[0]?.trim();
  return firstPart && firstPart.includes('=') ? firstPart : null;
}

function solveAcwScV2Cookie(html) {
  if (!html.includes('acw_sc__v2')) return null;

  const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)).map((match) => match[1]);
  for (const script of scripts) {
    if (!script.includes('acw_sc__v2')) continue;

    let cookieValue = '';
    const sandbox = {
      Date,
      document: {
        location: { reload: () => undefined },
        get cookie() {
          return cookieValue;
        },
        set cookie(value) {
          const pair = extractCookiePair(value);
          if (pair) cookieValue = pair;
        },
      },
      location: { reload: () => undefined },
      window: {},
    };

    try {
      vm.runInNewContext(script, sandbox, { timeout: 1000 });
      const cookie = extractCookiePair(cookieValue);
      if (cookie?.startsWith('acw_sc__v2=')) {
        return cookie;
      }
    } catch {
      // Ignore unsupported scripts and continue scanning.
    }
  }

  return null;
}

export function isLanzouShareUrl(downloadUrl) {
  try {
    const parsed = new URL(downloadUrl);
    return LANZOU_SHARE_HOST_RE.test(parsed.hostname) && !parsed.pathname.includes('/file/');
  } catch {
    return false;
  }
}

function mergeCookies(current, setCookie) {
  const cookieMap = new Map();

  for (const cookie of (current || '').split(';')) {
    const trimmed = cookie.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator > 0) {
      cookieMap.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
    }
  }

  const received = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const rawCookie of received) {
    const firstPart = rawCookie.split(';')[0]?.trim();
    if (!firstPart) continue;
    const separator = firstPart.indexOf('=');
    if (separator > 0) {
      cookieMap.set(firstPart.slice(0, separator), firstPart.slice(separator + 1));
    }
  }

  return Array.from(cookieMap.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
}

function requestPage(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const formBody = options.form ? new URLSearchParams(options.form).toString() : '';
    const headers = {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 TeamAgentX-Download-Resolver/1.0',
    };
    if (options.referer) headers.Referer = options.referer;
    if (options.cookie) headers.Cookie = options.cookie;
    if (formBody) {
      headers.Accept = 'application/json, text/javascript, */*; q=0.01';
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers['Content-Length'] = String(Buffer.byteLength(formBody));
      headers['X-Requested-With'] = 'XMLHttpRequest';
    }

    const request = client.request(url, {
      headers,
      method: options.method || (formBody ? 'POST' : 'GET'),
    }, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      const cookies = mergeCookies(options.cookie, response.headers['set-cookie']);

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error('蓝奏下载页重定向次数过多'));
          return;
        }
        resolve(requestPage(new URL(location, url).toString(), { ...options, cookie: cookies }, redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`蓝奏下载页请求失败：HTTP ${statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        const encoding = String(response.headers['content-encoding'] || '').toLowerCase();

        try {
          const finish = (text) => {
            const challengeCookie = solveAcwScV2Cookie(text);
            if (challengeCookie && redirectCount < MAX_REDIRECTS) {
              resolve(requestPage(url, { ...options, cookie: mergeCookies(cookies, challengeCookie) }, redirectCount + 1));
              return;
            }
            resolve({ body: text, url, cookies });
          };

          if (encoding.includes('br')) {
            finish(zlib.brotliDecompressSync(body).toString('utf8'));
          } else if (encoding.includes('gzip')) {
            finish(zlib.gunzipSync(body).toString('utf8'));
          } else if (encoding.includes('deflate')) {
            finish(zlib.inflateSync(body).toString('utf8'));
          } else {
            finish(body.toString('utf8'));
          }
        } catch (error) {
          reject(error);
        }
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error('蓝奏下载页请求超时'));
    });
    if (formBody) request.write(formBody);
    request.end();
  });
}

function resolveRedirectUrl(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const headers = {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      Pragma: 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.77 Safari/537.36',
    };
    if (options.referer) headers.Referer = options.referer;
    if (options.cookie) headers.Cookie = options.cookie;

    const request = client.request(url, { headers, method: 'GET' }, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      response.resume();

      if (statusCode >= 300 && statusCode < 400 && location) {
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error('蓝奏真实下载链接重定向次数过多'));
          return;
        }
        resolve(resolveRedirectUrl(new URL(location, url).toString(), options, redirectCount + 1));
        return;
      }

      resolve(url);
    });

    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error('蓝奏真实下载链接请求超时'));
    });
    request.end();
  });
}

export async function resolveLanzouDownloadUrl(downloadUrl) {
  if (!isLanzouShareUrl(downloadUrl)) {
    return downloadUrl;
  }

  const sharePage = await requestPage(downloadUrl);
  const iframeSrc = findLanzouIframeSrc(sharePage.body);
  if (!iframeSrc) {
    throw new Error('蓝奏下载页未找到下载 iframe');
  }

  const iframeUrl = new URL(iframeSrc, sharePage.url).toString();
  const iframePage = await requestPage(iframeUrl, { referer: sharePage.url, cookie: sharePage.cookies || undefined });
  const sign = findWpSign(iframePage.body);
  const ajaxmPath = findAjaxmPath(iframePage.body);

  if (sign && ajaxmPath) {
    const ajaxUrl = new URL(ajaxmPath, iframePage.url).toString();
    const ajaxPage = await requestPage(ajaxUrl, {
      method: 'POST',
      referer: sharePage.url,
      cookie: sharePage.cookies || undefined,
      form: {
        action: 'downprocess',
        signs: '?ctdf',
        sign,
        kd: '1',
      },
    });
    const downloadLink = parseAjaxDownloadUrl(ajaxPage.body);
    if (downloadLink) {
      return resolveRedirectUrl(downloadLink, {
        referer: 'https://developer.lanzoug.com',
        cookie: 'down_ip=1; expires=Sat, 16-Nov-2019 11:42:54 GMT; path=/; domain=.baidupan.com',
      });
    }
  }

  const href = findDownloadHref(iframePage.body);
  if (!href) {
    throw new Error('蓝奏下载页未找到真实下载链接');
  }

  return new URL(href, iframePage.url).toString();
}
