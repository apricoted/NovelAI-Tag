// 浏览器端图片参数读取：文本块/EXIF 直接走共享核心，PNG 无文本命中时再走隐写通道
//（隐写要全图像素，canvas 解码有成本，故放最后且只对 PNG 做）。核心口径见 params-core.js。
import { extractTextParams, readStealthParams, sniffImageKind } from './params-core.js';

const MAX_STEALTH_PIXELS = 32 * 1024 * 1024; // 超大图跳过隐写扫描，防卡顿

async function imagePixels(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const width = bitmap.width;
  const height = bitmap.height;
  if (!(width > 0 && height > 0) || width * height > MAX_STEALTH_PIXELS) {
    bitmap.close?.();
    return null;
  }
  try {
    let canvas;
    if (typeof OffscreenCanvas === 'function') {
      canvas = new OffscreenCanvas(width, height);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  } catch {
    return null;
  } finally {
    bitmap.close?.();
  }
}

// 返回 { prompt, negative, source, via } 或 null；via ∈ text / exif / stealth
export async function readImageParams(file) {
  if (!file || typeof file.arrayBuffer !== 'function') return null;
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return null;
  }
  const kind = sniffImageKind(new Uint8Array(buffer));
  if (!kind) return null;

  const fromText = await extractTextParams(buffer).catch(() => null);
  if (fromText) return fromText;

  if (kind !== 'png') return null;
  const pixels = await imagePixels(file);
  if (!pixels) return null;
  return readStealthParams(pixels).catch(() => null);
}
