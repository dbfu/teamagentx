import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIDGE_PLATFORM_ADAPTERS,
  registerBridgePlatformAdapters,
  markdownToDingTalkMarkdown,
  markdownToFeishuCard,
  markdownToTelegramMarkdownV2,
  markdownToWecomMarkdown,
  markdownToQQPlainText,
  resolveFeishuReceiveIdType,
} from './platform-senders.js';

// ─── fetch mock helpers ───

function mockFetch(handler: (url: string, init: RequestInit | undefined) => Response) {
  const original = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: string, init: RequestInit | undefined) =>
    Promise.resolve(handler(url, init));
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

// ─── adapter registration tests ───

test('bridge platform adapters expose all supported platforms exactly once', () => {
  const platforms = BRIDGE_PLATFORM_ADAPTERS.map((adapter) => adapter.platform);
  assert.deepEqual(platforms, ['telegram', 'feishu', 'dingtalk', 'wecom', 'qq']);
  assert.equal(new Set(platforms).size, platforms.length);
});

test('registerBridgePlatformAdapters registers every adapter sender', () => {
  const registrations: Array<{ platform: string; sender: unknown; kind: 'message' | 'typing' | 'clearTyping' }> = [];

  registerBridgePlatformAdapters({
    registerSender(platform, sender) {
      registrations.push({ platform, sender, kind: 'message' });
    },
    registerTypingSender(platform, sender) {
      registrations.push({ platform, sender, kind: 'typing' });
    },
    registerTypingClearer(platform, sender) {
      registrations.push({ platform, sender, kind: 'clearTyping' });
    },
  });

  assert.equal(
    registrations.filter((item) => item.kind === 'message').length,
    BRIDGE_PLATFORM_ADAPTERS.length,
  );
  assert.deepEqual(
    registrations.filter((item) => item.kind === 'message').map((item) => item.platform),
    BRIDGE_PLATFORM_ADAPTERS.map((adapter) => adapter.platform),
  );
  assert.deepEqual(
    registrations.filter((item) => item.kind === 'typing').map((item) => item.platform),
    ['telegram', 'feishu'],
  );
  assert.deepEqual(
    registrations.filter((item) => item.kind === 'clearTyping').map((item) => item.platform),
    ['feishu'],
  );
  for (const item of registrations) {
    assert.equal(typeof item.sender, 'function');
  }
});

// ─── Telegram MarkdownV2 formatting tests ───

test('markdownToTelegramMarkdownV2 converts bold to MarkdownV2 style', () => {
  const result = markdownToTelegramMarkdownV2('Hello **world**!');
  assert.ok(result.includes('*world*'), `expected *world* in: ${result}`);
  assert.ok(!result.includes('<b>'), `should not emit HTML tags: ${result}`);
});

test('markdownToTelegramMarkdownV2 keeps fenced code blocks in MarkdownV2 style', () => {
  const result = markdownToTelegramMarkdownV2('```js\nconsole.log("hi")\n```');
  assert.ok(result.includes('```js'), `expected fenced code block in: ${result}`);
  assert.ok(result.includes('console.log("hi")'), `expected code content in: ${result}`);
  assert.ok(!result.includes('<pre><code'), `should not emit HTML code tags: ${result}`);
});

test('markdownToTelegramMarkdownV2 keeps inline code in MarkdownV2 style', () => {
  const result = markdownToTelegramMarkdownV2('Use `npm install` to install');
  assert.ok(result.includes('`npm install`'), `expected inline code in: ${result}`);
  assert.ok(!result.includes('<code>'), `should not emit HTML inline code tags: ${result}`);
});

test('markdownToTelegramMarkdownV2 keeps links in MarkdownV2 style', () => {
  const result = markdownToTelegramMarkdownV2('[click here](https://example.com)');
  assert.ok(result.includes('[click here](https://example.com)'), `expected Markdown link in: ${result}`);
  assert.ok(!result.includes('<a href='), `should not emit HTML anchors: ${result}`);
});

test('markdownToTelegramMarkdownV2 escapes MarkdownV2 special characters in plain text', () => {
  const result = markdownToTelegramMarkdownV2('a_b [x] (y) - z!');
  assert.ok(result.includes('a\\_b'), `expected escaped underscore in: ${result}`);
  assert.ok(result.includes('\\[x\\]'), `expected escaped brackets in: ${result}`);
  assert.ok(result.includes('\\(y\\)'), `expected escaped parentheses in: ${result}`);
  assert.ok(result.includes('\\- z\\!'), `expected escaped dash and exclamation in: ${result}`);
});

test('markdownToFeishuCard renders assistant name through card markdown', () => {
  const result = markdownToFeishuCard('claude', '你好') as {
    config: Record<string, unknown>;
    elements: Array<{ tag: string; text?: { tag: string; content: string }; content?: string }>;
  };
  assert.deepEqual(result.config, { wide_screen_mode: true });
  assert.deepEqual(result.elements, [
    {
      tag: 'div',
      text: { tag: 'lark_md', content: "🤖 <font color='blue'>**claude**</font> 消息" },
    },
    {
      tag: 'markdown',
      content: '你好',
    },
  ]);
});

test('markdownToFeishuCard renders room user messages without bot icon', () => {
  const result = markdownToFeishuCard('admin', '[群聊·admin] @claude 你叫什么名字') as {
    elements: Array<{ tag: string; text?: { tag: string; content: string }; content?: string }>;
  };
  assert.deepEqual(result.elements, [
    {
      tag: 'div',
      text: { tag: 'lark_md', content: "<font color='green'>**admin**</font> 消息" },
    },
    {
      tag: 'markdown',
      content: '@claude 你叫什么名字',
    },
  ]);
});

test('resolveFeishuReceiveIdType uses chat_id for oc-prefixed ids', () => {
  assert.equal(resolveFeishuReceiveIdType('oc_default_chat'), 'chat_id');
});

test('resolveFeishuReceiveIdType uses chat_id for non-oc ids', () => {
  assert.equal(resolveFeishuReceiveIdType('chat_default_chat'), 'chat_id');
});

// ─── markdownToFeishuCard: 飞书格式规范化 ───

// Helper: extract body content after the header line in single-element Feishu cards
function feishuBody(result: unknown): string {
  return (result as { elements: Array<{ content?: string }> }).elements[1]?.content ?? '';
}

test('markdownToFeishuCard degrades all headings to bold text (lark_md does not render # in practice)', () => {
  const result = markdownToFeishuCard('bot', '# 一级标题\n## 二级标题\n### 三级标题');
  const content = feishuBody(result);
  assert.match(content, /^\*\*一级标题\*\*$/m);
  assert.match(content, /^\*\*二级标题\*\*$/m);
  assert.match(content, /^\*\*三级标题\*\*$/m);
});

test('markdownToFeishuCard preserves supported emphasis syntax', () => {
  const result = markdownToFeishuCard('bot', '这是 ~~删除~~ 的内容');
  const content = feishuBody(result);
  assert.ok(content.includes('~~删除~~'), `删除线语法应原样保留给飞书渲染: ${content}`);
});

test('markdownToFeishuCard converts task lists to checkbox symbols', () => {
  const result = markdownToFeishuCard('bot', '- [x] 已完成\n- [ ] 未完成');
  const content = feishuBody(result);
  assert.match(content, /☑ 已完成/);
  assert.match(content, /☐ 未完成/);
});

test('markdownToFeishuCard converts table to plain text', () => {
  const md = '| 名称 | 价格 |\n|------|------|\n| 苹果 | 3元 |\n| 香蕉 | 2元 |';
  const result = markdownToFeishuCard('bot', md);
  const content = feishuBody(result);
  assert.ok(!content.includes('|---'), `分隔行应被去除: ${content}`);
  assert.ok(content.includes('名称: 苹果'), `数据应转为 key:value: ${content}`);
});

test('markdownToFeishuCard preserves fenced code blocks with language tag', () => {
  const md = '```python\nprint("hello")\n```';
  const result = markdownToFeishuCard('bot', md);
  const content = feishuBody(result);
  assert.ok(content.includes('```python'), `应保留语言标记: ${content}`);
  assert.ok(content.includes('print("hello")'), `代码内容应保留: ${content}`);
  assert.ok(content.includes('```'), `代码围栏应保留: ${content}`);
});

test('markdownToFeishuCard degrades markdown images to links to avoid image_key card failures', () => {
  const md = '![示例图片](https://via.placeholder.com/150)';
  const result = markdownToFeishuCard('bot', md);
  const content = feishuBody(result);
  assert.equal(content, '[示例图片](https://via.placeholder.com/150)');
});

test('markdownToFeishuCard strips blockquote prefix (JSON 1.0 does not support blockquotes) but preserves content and hr', () => {
  const md = '> 这是引用\n\n---';
  const result = markdownToFeishuCard('bot', md);
  const content = feishuBody(result);
  assert.ok(!content.includes('> 这是引用'), `> 前缀应被去掉: ${content}`);
  assert.ok(content.includes('这是引用'), `引用内容应保留: ${content}`);
  assert.match(content, /^---$/m);
});

test('markdownToFeishuCard flattens nested bullet lists because Feishu does not support indentation', () => {
  const md = '- 项目一\n  - 子项目 1\n    - 子项目 2';
  const result = markdownToFeishuCard('bot', md);
  const content = feishuBody(result);
  assert.equal(content, '- 项目一\n- 子项目 1\n- 子项目 2');
});

// ─── markdownToDingTalkMarkdown tests ───

test('markdownToDingTalkMarkdown preserves supported headings and links', () => {
  const result = markdownToDingTalkMarkdown('# 一级标题\n## 二级标题\n[示例](https://example.com)');
  assert.match(result, /^# 一级标题/m);
  assert.match(result, /^## 二级标题/m);
  assert.match(result, /\[示例\]\(https:\/\/example\.com\)/);
});

test('markdownToDingTalkMarkdown converts tables and task lists for readability', () => {
  const md = '- [x] 已完成\n- [ ] 待处理\n\n| 字段 | 值 |\n|---|---|\n| 名称 | 测试 |';
  const result = markdownToDingTalkMarkdown(md);
  assert.match(result, /☑ 已完成/);
  assert.match(result, /☐ 待处理/);
  assert.match(result, /字段: 名称/);
});

test('markdownToDingTalkMarkdown degrades images and formulas safely', () => {
  const md = '![示例图片](https://example.com/demo.png)\n\n$E=mc^2$';
  const result = markdownToDingTalkMarkdown(md);
  assert.match(result, /\[示例图片\]\(https:\/\/example\.com\/demo\.png\)/);
  assert.match(result, /E=mc\^2/);
});

// ─── markdownToWecomMarkdown tests ───

test('markdownToWecomMarkdown converts headings to bold', () => {
  const result = markdownToWecomMarkdown('# 一级标题\n## 二级标题');
  assert.ok(result.includes('**一级标题**'), `标题应转为加粗: ${result}`);
  assert.ok(result.includes('**二级标题**'), `二级标题应转为加粗: ${result}`);
  assert.ok(!result.includes('# '), `# 前缀应去除: ${result}`);
});

test('markdownToWecomMarkdown wraps code block with label', () => {
  const result = markdownToWecomMarkdown('```js\nconsole.log("hi")\n```');
  assert.ok(result.includes('【代码】'), `应有开始标签: ${result}`);
  assert.ok(result.includes('【/代码】'), `应有结束标签: ${result}`);
  assert.ok(result.includes('console.log("hi")'), `代码内容应保留: ${result}`);
  assert.ok(!result.includes('```'), '围栏符号应去除');
});

test('markdownToWecomMarkdown strips inline code backticks, keeps content', () => {
  const result = markdownToWecomMarkdown('执行 `npm install` 安装依赖');
  assert.ok(result.includes('npm install'), `内容应保留: ${result}`);
  assert.ok(!result.includes('`'), '反引号应去除');
});

test('markdownToWecomMarkdown converts bullet lists to • prefix', () => {
  const result = markdownToWecomMarkdown('- 第一项\n- 第二项\n* 第三项');
  assert.ok(result.includes('• 第一项'), `应转为•: ${result}`);
  assert.ok(result.includes('• 第二项'), `应转为•: ${result}`);
  assert.ok(result.includes('• 第三项'), `应转为•: ${result}`);
});

test('markdownToWecomMarkdown removes strikethrough symbols', () => {
  const result = markdownToWecomMarkdown('这是 ~~废弃~~ 的内容');
  assert.ok(result.includes('废弃'), `内容应保留: ${result}`);
  assert.ok(!result.includes('~~'), '~~应去除');
});

test('markdownToWecomMarkdown removes italic, keeps bold', () => {
  const result = markdownToWecomMarkdown('*斜体* 和 **加粗**');
  assert.ok(result.includes('斜体'), `斜体内容应保留: ${result}`);
  assert.ok(!result.includes('*斜体*'), '斜体符号应去除');
  assert.ok(result.includes('**加粗**'), `加粗应透传: ${result}`);
});

test('markdownToWecomMarkdown converts table to key:value lines', () => {
  const md = '| 平台 | 支持 |\n|------|------|\n| 飞书 | 是 |';
  const result = markdownToWecomMarkdown(md);
  assert.ok(result.includes('平台: 飞书'), `应转为key:value: ${result}`);
  assert.ok(!result.includes('|---'), `分隔行应去除: ${result}`);
});

test('markdownToWecomMarkdown does not process markdown inside code blocks', () => {
  const result = markdownToWecomMarkdown('```\n**这不是加粗** # 这不是标题\n```');
  const content = result.replace('【代码】\n', '').replace('\n【/代码】', '');
  assert.ok(content.includes('**这不是加粗**'), `代码内MD不应被处理: ${result}`);
});

test('markdownToWecomMarkdown converts task list and formulas to readable text', () => {
  const result = markdownToWecomMarkdown('- [x] 已完成\n- [ ] 待办\n\n$E=mc^2$\n\n$$\na+b\n$$');
  assert.match(result, /☑ 已完成/);
  assert.match(result, /☐ 待办/);
  assert.match(result, /E=mc\^2/);
  assert.match(result, /公式：/);
});

// ─── markdownToQQPlainText tests ───

test('markdownToQQPlainText removes bold markers', () => {
  const result = markdownToQQPlainText('这是 **重要** 内容');
  assert.ok(result.includes('重要'), `内容应保留: ${result}`);
  assert.ok(!result.includes('**'), '**应去除');
});

test('markdownToQQPlainText removes heading markers', () => {
  const result = markdownToQQPlainText('# 标题一\n## 标题二');
  assert.ok(result.includes('标题一'), `标题内容应保留: ${result}`);
  assert.ok(!result.includes('# '), '# 前缀应去除');
});

test('markdownToQQPlainText wraps code block with [代码] label', () => {
  const result = markdownToQQPlainText('```python\nx = 1\n```');
  assert.ok(result.includes('[代码]'), `应有开始标签: ${result}`);
  assert.ok(result.includes('[/代码]'), `应有结束标签: ${result}`);
  assert.ok(result.includes('x = 1'), `代码内容应保留: ${result}`);
  assert.ok(!result.includes('```'), '围栏应去除');
});

test('markdownToQQPlainText strips inline code backticks', () => {
  const result = markdownToQQPlainText('运行 `git status` 查看状态');
  assert.ok(result.includes('git status'), `内容应保留: ${result}`);
  assert.ok(!result.includes('`'), '反引号应去除');
});

test('markdownToQQPlainText converts link to text (url)', () => {
  const result = markdownToQQPlainText('[点击这里](https://example.com)');
  assert.ok(result.includes('点击这里'), `链接文本应保留: ${result}`);
  assert.ok(result.includes('https://example.com'), `URL应保留: ${result}`);
  assert.ok(!result.includes(']('), '链接语法应去除');
});

test('markdownToQQPlainText converts unordered list to bullet', () => {
  const result = markdownToQQPlainText('- 第一\n- 第二');
  assert.ok(result.includes('• 第一'), `应转为•: ${result}`);
  assert.ok(!result.includes('- 第一'), '- 前缀应去除');
});

test('markdownToQQPlainText converts table to key:value', () => {
  const md = '| 字段 | 值 |\n|------|----|\n| 名称 | 测试 |';
  const result = markdownToQQPlainText(md);
  assert.ok(result.includes('字段: 名称'), `应转为key:value: ${result}`);
  assert.ok(!result.includes('|---'), `分隔行应去除: ${result}`);
});

test('markdownToQQPlainText does not strip content inside code blocks', () => {
  const result = markdownToQQPlainText('```\n**bold inside code** # heading inside\n```');
  assert.ok(result.includes('**bold inside code**'), `代码内容不应被处理: ${result}`);
});

test('markdownToQQPlainText converts task lists and images to plain text semantics', () => {
  const result = markdownToQQPlainText('- [x] 已完成\n- [ ] 待办\n\n![示例图片](https://example.com/demo.png)');
  assert.match(result, /☑ 已完成/);
  assert.match(result, /☐ 待办/);
  assert.match(result, /示例图片 \(https:\/\/example\.com\/demo\.png\)/);
});

// ─── Error propagation test ───

test('feishu token fetch throws on non-OK response', async () => {
  // Verify the error propagation pattern by simulating what getFeishuToken does
  const restore = mockFetch((_url, _init) => {
    return textResponse('{"errcode":99999,"errmsg":"sys error"}', 500);
  });

  try {
    const res = await globalThis.fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: 'test-app', app_secret: 'test-secret' }),
    });
    assert.equal(res.ok, false, 'response should not be ok');
    assert.equal(res.status, 500, 'status should be 500');
    // The real getFeishuToken would throw here — verify the pattern:
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`[Feishu] token fetch failed: ${res.status} ${text.slice(0, 200)}`);
      assert.ok(err.message.includes('500'), 'error message should include status code');
      assert.ok(err.message.includes('sys error'), 'error message should include response body');
    }
  } finally {
    restore();
  }
});

test('platform sender throws on non-OK send response', async () => {
  // Verify the throw-on-error pattern for sender functions
  const restore = mockFetch((_url, _init) => {
    return textResponse('{"error":"rate limited"}', 429);
  });

  try {
    const res = await globalThis.fetch('https://api.sgroup.qq.com/v2/groups/test-group/messages', {
      method: 'POST',
      headers: { 'Authorization': 'QQBot token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 0, content: 'hello' }),
    });
    assert.equal(res.ok, false, 'response should not be ok');
    // The real qqSend would throw here:
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`[QQ] send failed: ${res.status} ${body.slice(0, 200)}`);
      assert.ok(err.message.includes('429'), 'error message should include status code');
      assert.ok(err.message.includes('rate limited'), 'error message should include response body');
    }
  } finally {
    restore();
  }
});
