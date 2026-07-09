function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

function readChunkType(raw, offset) {
  return String.fromCharCode(raw[offset], raw[offset + 1], raw[offset + 2], raw[offset + 3]);
}

function parseTextChunk(data) {
  const sep = data.indexOf(0);
  if (sep < 0) return null;
  return {
    keyword: decodeText(data.subarray(0, sep)),
    text: decodeText(data.subarray(sep + 1)),
  };
}

function parseItxtChunk(data) {
  const firstSep = data.indexOf(0);
  if (firstSep < 0 || firstSep + 3 > data.length) return null;
  const keyword = decodeText(data.subarray(0, firstSep));
  const compressed = data[firstSep + 1] === 1;
  let offset = firstSep + 3;
  const langSep = data.indexOf(0, offset);
  if (langSep < 0) return null;
  offset = langSep + 1;
  const translatedSep = data.indexOf(0, offset);
  if (translatedSep < 0) return null;
  offset = translatedSep + 1;
  if (compressed) return null;
  return { keyword, text: decodeText(data.subarray(offset)) };
}

function readPngTextChunks(buffer) {
  const raw = new Uint8Array(buffer);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (raw.length < signature.length || signature.some((byte, index) => raw[index] !== byte)) return [];

  const view = new DataView(buffer);
  const chunks = [];
  let offset = 8;

  while (offset + 12 <= raw.length) {
    const size = view.getUint32(offset, false);
    const type = readChunkType(raw, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const next = dataEnd + 4;
    if (dataEnd > raw.length || next > raw.length) break;

    const data = raw.subarray(dataStart, dataEnd);
    const parsed = type === 'tEXt' ? parseTextChunk(data) : (type === 'iTXt' ? parseItxtChunk(data) : null);
    if (parsed?.keyword) chunks.push({ type, ...parsed });

    offset = next;
    if (type === 'IEND') break;
  }

  return chunks;
}

function splitWebuiParameters(text) {
  const settingsIndex = text.indexOf('Steps: ');
  const promptBlock = settingsIndex >= 0 ? text.slice(0, settingsIndex) : text;
  const marker = 'Negative prompt:';
  const negativeIndex = promptBlock.indexOf(marker);
  if (negativeIndex < 0) return { prompt: promptBlock.trim(), negative: '' };
  return {
    prompt: promptBlock.slice(0, negativeIndex).trim(),
    negative: promptBlock.slice(negativeIndex + marker.length).trim(),
  };
}

function naiV4CaptionText(data, key) {
  const node = data && typeof data === 'object' ? data[key] : null;
  const caption = node && typeof node === 'object' && node.caption && typeof node.caption === 'object' ? node.caption : {};
  const parts = [];
  if (caption.base_caption) parts.push(String(caption.base_caption));
  for (const item of caption.char_captions || []) {
    if (item && typeof item === 'object' && item.char_caption) parts.push(String(item.char_caption));
  }
  return parts.join('\n').trim();
}

function promptFromChunks(chunks) {
  const fields = {};
  for (const chunk of chunks) fields[chunk.keyword] = chunk.text;

  let prompt = '';
  let negative = '';
  let source = fields.Software || fields.Source || 'PNG';

  if (fields.Comment) {
    try {
      const comment = JSON.parse(fields.Comment);
      prompt = naiV4CaptionText(comment, 'v4_prompt') || String(comment.prompt || '');
      negative = naiV4CaptionText(comment, 'v4_negative_prompt') || String(comment.uc || comment.negative_prompt || '');
      if (fields.Software === 'NovelAI' || prompt || negative) source = 'NovelAI';
    } catch {
      // 普通文本 Comment 不是错误；继续尝试 Description / parameters。
    }
  }

  if (!prompt && fields.Description) {
    prompt = fields.Description;
    if (fields.Software === 'NovelAI' || fields.Source === 'NovelAI' || fields.Comment) source = 'NovelAI';
  }

  if (!prompt && fields.parameters) {
    const webui = splitWebuiParameters(fields.parameters);
    prompt = webui.prompt;
    negative = webui.negative;
    source = 'SD-WEBUI';
  }

  prompt = prompt.trim();
  negative = negative.trim();
  return prompt || negative ? { prompt, negative, source } : null;
}

export async function readImagePrompt(file) {
  if (!file || (!/^image\/png$/i.test(file.type || '') && !/\.png$/i.test(file.name || ''))) return null;
  try {
    const chunks = readPngTextChunks(await file.arrayBuffer());
    return chunks.length ? promptFromChunks(chunks) : null;
  } catch {
    return null;
  }
}
