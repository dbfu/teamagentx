import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  extractLanzouDownloadUrl,
  isLanzouShareUrl,
  resolveLanzouDownloadUrl,
  solveAcwScV2Cookie,
} from './update-download.ts';

describe('update download helpers', () => {
  test('detects Lanzou share hosts', () => {
    assert.equal(isLanzouShareUrl('https://wwbjc.lanzouu.com/iabc123'), true);
    assert.equal(isLanzouShareUrl('https://developer2.lanrar.com/file/example.dmg'), false);
    assert.equal(isLanzouShareUrl('https://releases.teamagentx.com/app.dmg'), false);
  });

  test('extracts real download URL from iframe content', () => {
    const shareUrl = 'https://wwbjc.lanzouu.com/iabc123';
    const html = `
      <html>
        <body>
          <iframe class="n_downlink" src="/fn?token=abc"></iframe>
        </body>
      </html>
    `;
    const iframeHtml = `
      <html>
        <body>
          <div id="tour">
            <a href="https://developer2.lanrar.com/file/?BmBbZVloV2YJAFFpVmMCb1VqVW0FDLE2B2...UHhW01F" target="_blank" rel="noreferrer">下载</a>
          </div>
        </body>
      </html>
    `;

    assert.equal(
      extractLanzouDownloadUrl(html, shareUrl, iframeHtml),
      'https://developer2.lanrar.com/file/?BmBbZVloV2YJAFFpVmMCb1VqVW0FDLE2B2...UHhW01F',
    );
  });

  test('resolves relative iframe and download hrefs against their own page URLs', () => {
    const shareUrl = 'https://wwbjc.lanzouu.com/iabc123';
    const html = '<iframe class="n_downlink" src="/fn?token=abc"></iframe>';
    const iframeHtml = '<a href="/file/example.dmg">下载</a>';

    assert.equal(
      extractLanzouDownloadUrl(html, shareUrl, iframeHtml),
      'https://wwbjc.lanzouu.com/file/example.dmg',
    );
  });

  test('requests iframe with share page referer and cookies', async () => {
    const calls: Array<{ url: string; referer?: string; cookie?: string }> = [];

    const resolvedUrl = await resolveLanzouDownloadUrl('https://wwbjc.lanzouu.com/iabc123', async (url, options = {}) => {
      calls.push({ url, referer: options.referer, cookie: options.cookie });

      if (url === 'https://wwbjc.lanzouu.com/iabc123') {
        return {
          body: '<iframe class="n_downlink" src="/fn?token=abc"></iframe>',
          url: 'https://wwbjc.lanzouu.com/iabc123',
          cookies: 'share_session=abc123',
        };
      }

      return {
        body: '<a href="https://developer2.lanrar.com/file/example.dmg">下载</a>',
        url,
        cookies: '',
      };
    });

    assert.equal(resolvedUrl, 'https://developer2.lanrar.com/file/example.dmg');
    assert.deepEqual(calls, [
      { url: 'https://wwbjc.lanzouu.com/iabc123', referer: undefined, cookie: undefined },
      { url: 'https://wwbjc.lanzouu.com/fn?token=abc', referer: 'https://wwbjc.lanzouu.com/iabc123', cookie: 'share_session=abc123' },
    ]);
  });

  test('uses iframe wp_sign and ajaxm API to resolve public share links', async () => {
    const calls: Array<{ url: string; method?: string; body?: Record<string, string>; referer?: string }> = [];

    const resolvedUrl = await resolveLanzouDownloadUrl(
      'https://wwbjc.lanzouu.com/iabc123',
      async (url, options = {}) => {
        calls.push({ url, method: options.method, body: options.form, referer: options.referer });

        if (url === 'https://wwbjc.lanzouu.com/iabc123') {
          return {
            body: '<iframe class="n_downlink" src="/fn?token=abc"></iframe>',
            url,
            cookies: '',
          };
        }

        if (url === 'https://wwbjc.lanzouu.com/fn?token=abc') {
          return {
            body: `
              <script>
                var wp_sign = 'SIGN_123';
                var a = '/ajaxm.php?file=111';
                var b = '/ajaxm.php?file=222';
              </script>
            `,
            url,
            cookies: '',
          };
        }

        return {
          body: JSON.stringify({ zt: 1, dom: 'https://developer2.lanrar.com', url: 'abc/example.dmg' }),
          url,
          cookies: '',
        };
      },
      async url => url.replace('https://developer2.lanrar.com/file/abc/example.dmg', 'https://download.example.com/example.dmg'),
    );

    assert.equal(resolvedUrl, 'https://download.example.com/example.dmg');
    assert.deepEqual(calls, [
      { url: 'https://wwbjc.lanzouu.com/iabc123', method: undefined, body: undefined, referer: undefined },
      { url: 'https://wwbjc.lanzouu.com/fn?token=abc', method: undefined, body: undefined, referer: 'https://wwbjc.lanzouu.com/iabc123' },
      {
        url: 'https://wwbjc.lanzouu.com/ajaxm.php?file=222',
        method: 'POST',
        body: { action: 'downprocess', signs: '?ctdf', sign: 'SIGN_123', kd: '1' },
        referer: 'https://wwbjc.lanzouu.com/iabc123',
      },
    ]);
  });

  test('solves acw_sc__v2 JavaScript challenge cookie', () => {
    const html = `
      <html>
        <script>
          document.cookie = 'acw_sc__v2=challenge-token;path=/;max-age=3600';
          document.location.reload();
        </script>
      </html>
    `;

    assert.equal(solveAcwScV2Cookie(html), 'acw_sc__v2=challenge-token');
  });
});
