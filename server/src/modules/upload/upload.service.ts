import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';

// Electron 打包时使用环境变量指定的路径，否则使用 cwd/uploads
const UPLOAD_ROOT = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const IMAGE_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'images');
const AUDIO_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'audio');
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_AUDIO_MIME_TYPES = ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4'];

// MIME 类型到扩展名的映射
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
};

/**
 * 校验音频文件魔数，确保文件内容与声明的 MIME 类型一致
 * 防止伪造 Content-Type 上传非音频文件
 */
function validateAudioMagicBytes(buffer: Buffer, mimeType: string): void {
  if (buffer.length < 12) {
    throw new Error('音频文件过小，无法校验格式');
  }

  const matchesPrefix = (offset: number, bytes: number[]): boolean =>
    bytes.every((b, i) => buffer[offset + i] === b);

  switch (mimeType) {
    case 'audio/wav': {
      // "RIFF" 52 49 46 46
      if (!matchesPrefix(0, [0x52, 0x49, 0x46, 0x46])) {
        throw new Error('WAV 文件魔数不匹配');
      }
      return;
    }
    case 'audio/mpeg': {
      // "ID3" 49 44 33 或 MP3 frame sync FF FB / FF F3 / FF F2
      if (matchesPrefix(0, [0x49, 0x44, 0x33])) return;
      if (buffer[0] === 0xff && (buffer[1] === 0xfb || buffer[1] === 0xf3 || buffer[1] === 0xf2)) return;
      throw new Error('MP3 文件魔数不匹配');
    }
    case 'audio/webm': {
      // EBML header: 1A 45 DF A3
      if (!matchesPrefix(0, [0x1a, 0x45, 0xdf, 0xa3])) {
        throw new Error('WebM 文件魔数不匹配');
      }
      return;
    }
    case 'audio/mp4': {
      // offset 4: "ftyp" 66 74 79 70
      if (!matchesPrefix(4, [0x66, 0x74, 0x79, 0x70])) {
        throw new Error('M4A/MP4 文件魔数不匹配');
      }
      return;
    }
    default:
      // 未在白名单显式列出的类型按 MIME 白名单已经拦截，这里直接拒绝
      throw new Error(`无法校验该类型的音频魔数: ${mimeType}`);
  }
}

/**
 * 校验图片文件魔数，确保确实是图片再落盘，避免把任意本地文件复制进 uploads
 */
function validateImageMagicBytes(buffer: Buffer): void {
  if (buffer.length < 12) {
    throw new Error('图片文件过小，无法校验格式');
  }

  const matchesPrefix = (offset: number, bytes: number[]): boolean =>
    bytes.every((b, i) => buffer[offset + i] === b);

  // PNG 89 50 4E 47
  if (matchesPrefix(0, [0x89, 0x50, 0x4e, 0x47])) return;
  // JPEG FF D8 FF
  if (matchesPrefix(0, [0xff, 0xd8, 0xff])) return;
  // GIF "GIF8"
  if (matchesPrefix(0, [0x47, 0x49, 0x46, 0x38])) return;
  // WEBP: "RIFF"...."WEBP"
  if (matchesPrefix(0, [0x52, 0x49, 0x46, 0x46]) && matchesPrefix(8, [0x57, 0x45, 0x42, 0x50])) return;

  throw new Error('图片文件魔数不匹配');
}

interface UploadResult {
  type: 'image' | 'audio';
  filename: string;  // 原始文件名
  mimeType: string;
  size: number;
  url: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export const uploadService = {
  getImageUploadDir() {
    return IMAGE_UPLOAD_DIR;
  },

  getStaticRootDir() {
    return UPLOAD_ROOT;
  },

  getImageUrlPrefix() {
    return '/uploads/images';
  },

  /**
   * 初始化上传目录
   */
  async init() {
    await fs.mkdir(IMAGE_UPLOAD_DIR, { recursive: true });
    await fs.mkdir(AUDIO_UPLOAD_DIR, { recursive: true });
  },

  /**
   * 处理上传的图片文件
   */
  async processImage(file: Awaited<ReturnType<FastifyRequest['file']>>): Promise<UploadResult> {
    if (!file) {
      throw new Error('未提供文件');
    }

    // 验证 MIME 类型
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      throw new Error(`不支持的文件类型: ${file.mimetype}`);
    }

    // 读取文件内容
    const buffer = await file.toBuffer();

    // 验证文件大小
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`文件大小超出限制: ${buffer.length} > ${MAX_FILE_SIZE}`);
    }

    // 生成唯一文件名（使用 MIME 类型推断扩展名）
    const ext = MIME_TO_EXT[file.mimetype] || 'png';
    const id = uuidv4();
    const filename = `${id}.${ext}`;

    // 保存文件
    await fs.writeFile(path.join(IMAGE_UPLOAD_DIR, filename), buffer);

    return {
      type: 'image',
      filename: file.filename, // 原始文件名
      mimeType: file.mimetype,
      size: buffer.length,
      url: `/uploads/images/${filename}`,
    };
  },

  /**
   * 从本地文件保存一张图片到 uploads 目录，返回可访问的 /uploads/images/... URL。
   * 用于把助手消息里指向工作目录的本地图片转存为静态资源。
   */
  async saveImageFromFile(sourcePath: string): Promise<string> {
    const rawExt = path.extname(sourcePath).toLowerCase().replace(/^\./, '');
    const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
    if (!['png', 'jpg', 'gif', 'webp'].includes(ext)) {
      throw new Error(`不支持的图片类型: ${rawExt}`);
    }

    const buffer = await fs.readFile(sourcePath);
    if (buffer.length === 0) {
      throw new Error('图片文件为空');
    }
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`文件大小超出限制: ${buffer.length} > ${MAX_FILE_SIZE}`);
    }

    // 校验魔数，防止把任意本地文件当作图片转存
    validateImageMagicBytes(buffer);

    const filename = `${uuidv4()}.${ext}`;
    await fs.writeFile(path.join(IMAGE_UPLOAD_DIR, filename), buffer);

    return `/uploads/images/${filename}`;
  },

  /**
   * 处理上传的音频文件
   */
  async processAudio(file: Awaited<ReturnType<FastifyRequest['file']>>): Promise<UploadResult> {
    if (!file) {
      throw new Error('未提供文件');
    }

    // 截断 codec 参数（如 audio/webm;codecs=opus → audio/webm）
    const baseMime = file.mimetype.split(';')[0].trim();
    if (!ALLOWED_AUDIO_MIME_TYPES.includes(baseMime)) {
      throw new Error(`不支持的文件类型: ${file.mimetype}`);
    }

    const buffer = await file.toBuffer();

    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`文件大小超出限制: ${buffer.length} > ${MAX_FILE_SIZE}`);
    }

    // 校验文件头魔数，防止伪造 Content-Type
    validateAudioMagicBytes(buffer, baseMime);

    const ext = MIME_TO_EXT[baseMime] || 'bin';
    const id = uuidv4();
    const filename = `${id}.${ext}`;

    await fs.writeFile(path.join(AUDIO_UPLOAD_DIR, filename), buffer);

    return {
      type: 'audio',
      filename: file.filename,
      mimeType: baseMime,
      size: buffer.length,
      url: `/uploads/audio/${filename}`,
    };
  },

  /**
   * 批量处理图片
   */
  async processImages(files: AsyncIterableIterator<MultipartFile>): Promise<UploadResult[]> {
    const results: UploadResult[] = [];

    for await (const file of files) {
      const result = await uploadService.processImage(file as any);
      results.push(result);
    }

    return results;
  },

  /**
   * 删除图片文件
   */
  async deleteImage(url: string) {
    const filename = path.basename(url);
    const filepath = path.join(IMAGE_UPLOAD_DIR, filename);

    // 安全检查：确保路径在允许的目录内
    const resolvedPath = path.resolve(filepath);
    if (!resolvedPath.startsWith(path.resolve(IMAGE_UPLOAD_DIR))) {
      throw new Error('非法路径');
    }

    await fs.unlink(filepath).catch(() => {});
  },
  /**
   * 删除音频文件
   */
  async deleteAudio(url: string) {
    const filename = path.basename(url);
    const filepath = path.join(AUDIO_UPLOAD_DIR, filename);

    const resolvedPath = path.resolve(filepath);
    if (!resolvedPath.startsWith(path.resolve(AUDIO_UPLOAD_DIR))) {
      throw new Error('非法路径');
    }

    await fs.unlink(filepath).catch(() => {});
  },
};
