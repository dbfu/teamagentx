import imageCompression from 'browser-image-compression';

/**
 * 图片压缩配置
 */
const compressionOptions = {
  maxSizeMB: 1,  // 最大 1MB
  maxWidthOrHeight: 1920,  // 最大宽高 1920px
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
  initialQuality: 0.8,
};

const MAX_UPLOAD_SIZE_MB = 10;
const TALL_IMAGE_MIN_ASPECT_RATIO = 3;
const TALL_IMAGE_MAX_WIDTH = 1440;
const TALL_IMAGE_MAX_CANVAS_HEIGHT = 30000;
const TALL_IMAGE_JPEG_QUALITY = 0.92;

// MIME 类型到扩展名的映射
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function isTallImage(dimensions: { width: number; height: number }): boolean {
  return dimensions.width > 0 && dimensions.height / dimensions.width >= TALL_IMAGE_MIN_ASPECT_RATIO;
}

function withImageExtension(file: File, mimeType: string): string {
  const ext = MIME_TO_EXT[mimeType] || 'jpg';
  const originalName = file.name.replace(/\.[^.]+$/, '') || 'image';
  return `${originalName}.${ext}`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法加载图片'));
    };

    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('图片压缩失败'));
      }
    }, type, quality);
  });
}

async function compressTallImage(file: File, dimensions: { width: number; height: number }): Promise<File> {
  if (file.size <= MAX_UPLOAD_SIZE_MB * 1024 * 1024 && dimensions.width <= TALL_IMAGE_MAX_WIDTH) {
    return file;
  }

  const widthScale = Math.min(1, TALL_IMAGE_MAX_WIDTH / dimensions.width);
  const heightScale = Math.min(1, TALL_IMAGE_MAX_CANVAS_HEIGHT / dimensions.height);
  const scale = Math.min(widthScale, heightScale);
  const targetWidth = Math.max(1, Math.round(dimensions.width * scale));
  const targetHeight = Math.max(1, Math.round(dimensions.height * scale));

  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    return file;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(img, 0, 0, targetWidth, targetHeight);

  const mimeType = 'image/jpeg';
  const blob = await canvasToBlob(canvas, mimeType, TALL_IMAGE_JPEG_QUALITY);
  return new File([blob], withImageExtension(file, mimeType), { type: mimeType });
}

/**
 * 压缩图片文件
 * @returns 带有正确文件名的压缩后 File 对象
 */
export async function compressImage(file: File): Promise<File> {
  // 如果文件已经是压缩格式且小于 1MB，直接返回
  if (file.size <= 1 * 1024 * 1024 && file.type === 'image/jpeg') {
    return file;
  }

  try {
    const dimensions = await getImageDimensions(file);
    if (isTallImage(dimensions)) {
      return await compressTallImage(file, dimensions);
    }

    const compressedFile = await imageCompression(file, compressionOptions);

    // 确保压缩后的文件有正确的文件名（带扩展名，且与 MIME 类型匹配）
    const properName = withImageExtension(file, compressedFile.type);
    const ext = MIME_TO_EXT[compressedFile.type] || 'jpg';

    // 检查文件名是否与 MIME 类型匹配（如 test-image.png 但 MIME 是 jpeg）
    const currentExt = compressedFile.name.split('.').pop()?.toLowerCase() || '';
    const expectedExt = ext.toLowerCase();

    // 如果文件名不对，或者扩展名与 MIME 类型不匹配，创建一个新的 File 对象
    if (compressedFile.name === 'blob' || !compressedFile.name.includes('.') || currentExt !== expectedExt) {
      return new File([compressedFile], properName, { type: compressedFile.type });
    }

    return compressedFile;
  } catch (error) {
    console.error('图片压缩失败:', error);
    // 压缩失败时返回原文件
    return file;
  }
}

/**
 * 将 File 转换为 base64 字符串
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 移除 data:image/xxx;base64, 前缀，只保留 base64 数据
      const base64Data = result.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 创建本地预览 URL（用于显示）
 */
export function createPreviewUrl(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * 清理预览 URL
 */
export function revokePreviewUrl(url: string): void {
  URL.revokeObjectURL(url);
}

/**
 * 获取图片尺寸信息
 */
export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法加载图片'));
    };

    img.src = url;
  });
}

/**
 * 验证图片文件类型
 */
export function isValidImageType(file: File): boolean {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  return allowedTypes.includes(file.type);
}

/**
 * 验证图片文件大小
 */
export function isValidImageSize(file: File, maxSizeMB: number = 10): boolean {
  return file.size <= maxSizeMB * 1024 * 1024;
}

/**
 * 处理图片上传的完整流程：
 * 1. 验证类型和大小
 * 2. 压缩图片
 * 3. 获取尺寸
 * 4. 生成 base64
 * 5. 上传到服务器
 */
export async function processImageForUpload(
  file: File,
  uploadApiUrl: string
): Promise<{
  success: boolean;
  data?: {
    url: string;
    filename: string;
    mimeType: string;
    size: number;
    width: number;
    height: number;
    base64: string;
  };
  error?: string;
}> {
  // 验证类型
  if (!isValidImageType(file)) {
    return { success: false, error: '不支持的文件类型' };
  }

  // 验证大小
  if (!isValidImageSize(file, 10)) {
    return { success: false, error: '文件大小超出限制（最大 10MB）' };
  }

  try {
    // 压缩图片
    const compressedFile = await compressImage(file);

    // 获取尺寸
    const dimensions = await getImageDimensions(compressedFile);

    // 生成 base64
    const base64 = await fileToBase64(compressedFile);

    // 上传到服务器
    const formData = new FormData();
    formData.append('file', compressedFile);

    const response = await fetch(uploadApiUrl, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (!result.success) {
      return { success: false, error: result.error || '上传失败' };
    }

    return {
      success: true,
      data: {
        url: result.data.url,
        filename: result.data.filename,
        mimeType: result.data.mimeType,
        size: result.data.size,
        width: dimensions.width,
        height: dimensions.height,
        base64,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '处理失败';
    return { success: false, error: message };
  }
}
