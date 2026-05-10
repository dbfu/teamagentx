import { tool } from 'langchain';
import { z } from 'zod';

/**
 * Web Fetch 工具
 * 用于 LangChain Agent 抓取网页内容并提取信息
 */

// 默认超时时间（毫秒）
const DEFAULT_TIMEOUT = 120000; // 120 秒

// Web Fetch 工具 - 抓取网页内容
export const webFetchTool = tool(
  async ({
    url,
    prompt,
    timeout,
  }: {
    url: string;
    prompt: string;
    timeout?: number;
  }) => {
    // 创建超时控制器
    const timeoutMs = timeout && timeout > 0 ? timeout * 1000 : DEFAULT_TIMEOUT;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // 验证 URL
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return `不支持的协议: ${urlObj.protocol}，仅支持 http 和 https`;
      }

      // 抓取网页
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!response.ok) {
        return `请求失败: HTTP ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get('content-type') || '';

      // 处理非 HTML 内容
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('text/plain')
      ) {
        // 对于二进制文件，返回基本信息
        const contentLength = response.headers.get('content-length');
        return `非文本内容: ${contentType}${
          contentLength
            ? `, 大小: ${Math.round(parseInt(contentLength) / 1024)}KB`
            : ''
        }`;
      }

      const html = await response.text();

      // 简单的 HTML 清理和文本提取
      let text = html
        // 移除 script 和 style 标签及其内容
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        // 移除注释
        .replace(/<!--[\s\S]*?-->/g, '')
        // 将块级元素转换为换行
        .replace(/<\/(p|div|br|li|tr|th|td|h[1-6])>/gi, '\n')
        .replace(/<(p|div|br|li|tr|th|td|h[1-6])[^>]*>/gi, '\n')
        // 移除所有其他 HTML 标签
        .replace(/<[^>]+>/g, '')
        // 解码常见 HTML 实体
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // 清理多余空白
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();

      // 限制内容长度，避免过大
      const maxLength = 50000;
      if (text.length > maxLength) {
        text = text.substring(0, maxLength) + '\n\n... [内容已截断]';
      }

      // 如果没有 prompt，直接返回内容
      if (!prompt || prompt.trim() === '') {
        return `URL: ${url}\n标题: ${extractTitle(html)}\n\n${text}`;
      }

      // 根据 prompt 提取信息（简单的关键词匹配和提取）
      const result = extractByPrompt(text, prompt);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        if (
          error.name === 'AbortError' ||
          error.message.includes('timeout') ||
          error.message.includes('aborted')
        ) {
          return `请求超时 (${timeoutMs / 1000}秒): ${url}`;
        }
        if (error.message.includes('Invalid URL')) {
          return `无效的 URL: ${url}`;
        }
        return `抓取失败: ${error.message}`;
      }
      return `抓取失败: ${String(error)}`;
    } finally {
      clearTimeout(timeoutId);
    }
  },
  {
    name: 'web_fetch',
    description:
      '抓取网页内容并提取信息。可以获取网页的文本内容，或根据提示提取特定信息。支持 HTTP/HTTPS 协议。',
    schema: z.object({
      url: z
        .string()
        .describe('要抓取的网页 URL（必须以 http:// 或 https:// 开头）'),
      prompt: z
        .string()
        .describe(
          '提取提示，描述你想从网页中获取什么信息。例如："提取所有链接"、"找出文章标题和摘要"、"获取价格信息"。留空则返回网页全文。',
        ),
      timeout: z
        .number()
        .optional()
        .describe('超时时间（秒），默认 30 秒。对于慢速网站可以适当增加。'),
    }),
  },
);

/**
 * 从 HTML 中提取标题
 */
function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : '无标题';
}

/**
 * 根据 prompt 简单提取信息
 * 注意：这是一个简化实现，复杂的提取需求应该使用 LLM
 */
function extractByPrompt(text: string, prompt: string): string {
  const lowerPrompt = prompt.toLowerCase();
  const lines = text.split('\n');

  // 提取链接
  if (lowerPrompt.includes('链接') || lowerPrompt.includes('link')) {
    const urlPattern = /https?:\/\/[^\s<>"']+/g;
    const links = text.match(urlPattern) || [];
    if (links.length > 0) {
      return `找到 ${links.length} 个链接:\n${links.slice(0, 50).join('\n')}${
        links.length > 50 ? '\n... [已截断]' : ''
      }`;
    }
    return '未找到链接';
  }

  // 提取邮箱
  if (lowerPrompt.includes('邮箱') || lowerPrompt.includes('email')) {
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = text.match(emailPattern) || [];
    if (emails.length > 0) {
      return `找到 ${emails.length} 个邮箱:\n${[...new Set(emails)].join('\n')}`;
    }
    return '未找到邮箱';
  }

  // 提取数字/价格
  if (
    lowerPrompt.includes('价格') ||
    lowerPrompt.includes('数字') ||
    lowerPrompt.includes('price') ||
    lowerPrompt.includes('number')
  ) {
    const numberPattern = /(?:¥|\$|€|£)?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
    const numbers = text.match(numberPattern) || [];
    if (numbers.length > 0) {
      return `找到 ${numbers.length} 个数字/价格:\n${numbers.slice(0, 30).join('\n')}`;
    }
    return '未找到数字/价格';
  }

  // 提取标题（通常是大写或较短的行）
  if (lowerPrompt.includes('标题') || lowerPrompt.includes('title')) {
    const titleLines = lines.filter(
      (line) =>
        line.trim().length > 0 &&
        line.trim().length < 100 &&
        !line.startsWith('http') &&
        !line.includes('©') &&
        !line.includes('版权'),
    );
    if (titleLines.length > 0) {
      return `可能的标题:\n${titleLines.slice(0, 5).join('\n')}`;
    }
    return '未找到标题';
  }

  // 提取摘要（前几段）
  if (
    lowerPrompt.includes('摘要') ||
    lowerPrompt.includes('简介') ||
    lowerPrompt.includes('summary') ||
    lowerPrompt.includes('abstract')
  ) {
    const paragraphs = lines
      .filter((line) => line.trim().length > 50)
      .slice(0, 3);
    if (paragraphs.length > 0) {
      return `摘要:\n${paragraphs.join('\n\n')}`;
    }
    return '未找到摘要内容';
  }

  // 默认：搜索包含 prompt 关键词的段落
  const keywords = prompt.split(/[\s,，、]+/).filter((k) => k.length > 1);
  if (keywords.length > 0) {
    const relevantLines = lines.filter((line) =>
      keywords.some((k) => line.toLowerCase().includes(k.toLowerCase())),
    );
    if (relevantLines.length > 0) {
      return `与「${prompt}」相关的内容:\n${relevantLines.slice(0, 20).join('\n')}`;
    }
  }

  // 如果没有匹配，返回前 2000 字符
  return `未找到与「${prompt}」直接相关的内容，以下是网页开头部分:\n${text.substring(0, 2000)}`;
}

// Web Fetch 工具列表
export const webFetchTools = [webFetchTool];
