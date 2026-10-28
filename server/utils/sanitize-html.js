import sharp from 'sharp';

/**
 * Санитайзер HTML тела «Подробнее» пометки значимости.
 *
 * Менеджер редактирует текст в визуальном редакторе (как в Word): жирный,
 * курсив, подчёркивание, заголовки, списки, выравнивание, ссылки и картинки.
 * Всё это приходит как HTML и хранится как HTML, но наружу уходит только
 * вычищенный белый список тегов и атрибутов — без скриптов, стилей и
 * обработчиков.
 */

/** Разрешённые теги. */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'a', 'img',
  'blockquote',
  'span',
  'div',
]);

/** Разрешённые атрибуты по тегам. */
const ALLOWED_ATTRS = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height', 'style']),
  div: new Set(['data-promo', 'style', 'align']),
  span: new Set(['style']),
  p: new Set(['style', 'align']),
  h2: new Set(['style', 'align']),
  h3: new Set(['style', 'align']),
  h4: new Set(['style', 'align']),
  li: new Set(['style']),
  blockquote: new Set(['style']),
};

/** Безопасные значения inline-style: только выравнивание и размер шрифта. */
const SAFE_STYLE_PROPS = new Set(['text-align', 'font-size', 'width', 'height', 'max-width']);

function isSafeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return false;
  // data:image — вставленные картинки; http(s) — ссылки.
  return /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)
    || /^https?:\/\//i.test(value);
}

function sanitizeStyle(style) {
  if (!style) return '';
  const parts = String(style).split(';').map((chunk) => chunk.trim()).filter(Boolean);
  const safe = [];
  for (const part of parts) {
    const [prop, ...rest] = part.split(':');
    const name = String(prop || '').trim().toLowerCase();
    const value = rest.join(':').trim().toLowerCase();
    if (!SAFE_STYLE_PROPS.has(name)) continue;
    if (name === 'text-align' && ['left', 'center', 'right', 'justify'].includes(value)) {
      safe.push(`text-align: ${value}`);
    }
    if (name === 'font-size' && /^\d{1,2}(px|rem|em|%)$/.test(value)) {
      safe.push(`font-size: ${value}`);
    }
    // Размер картинок из редактора: проценты/пиксели/auto.
    if (['width', 'height', 'max-width'].includes(name) && /^(\d{1,4}(px|%)|auto|max-content)$/.test(value)) {
      safe.push(`${name}: ${value}`);
    }
  }
  return safe.join('; ');
}

/**
 * Вычищает HTML до белого списка. Без внешних зависимостей: парсер DOM
 * отсутствует в node, поэтому работаем тег-за-тегом через regex — вход
 * контролируется длиной, а сложные конструкции просто вычищаются.
 *
 * Лимит generous: вставленные картинки — это base64 data-URL, каждая до
 * ~500 КБ; конвертация картинок в WebP делается отдельно (маршрут), здесь
 * только белый список.
 */
const MAX_HTML_BYTES = 3 * 1024 * 1024;

async function compressDataImage(dataUrl) {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  try {
    const webp = await sharp(buffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, alphaQuality: 90 })
      .toBuffer();
    return `data:image/webp;base64,${webp.toString('base64')}`;
  } catch (err) {
    console.error('[sanitize-html] image compression failed:', err.message);
    return null;
  }
}

export async function sanitizeDetailHtml(html) {
  if (typeof html !== 'string') return null;
  let source = html.trim();
  if (!source) return null;
  source = source.slice(0, MAX_HTML_BYTES);

  // Убираем всё опасное целиком.
  source = source
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');

  // Вычищаем теги.
  const result = source.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (full, tagName, rawAttrs) => {
      const tag = String(tagName).toLowerCase();
      const closing = full.startsWith('</');

      if (!ALLOWED_TAGS.has(tag)) return '';
      if (closing) return `</${tag}>`;

      // Разбор атрибутов.
      const attrs = [];
      const attrPattern = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
      let match;
      const allowed = ALLOWED_ATTRS[tag] || new Set();
      while ((match = attrPattern.exec(String(rawAttrs))) !== null) {
        const name = String(match[1]).toLowerCase();
        const value = match[2] ?? match[3] ?? match[4] ?? '';
        if (!allowed.has(name)) continue;
        if (name === 'style') {
          const safe = sanitizeStyle(value);
          if (safe) attrs.push(`style="${safe}"`);
          continue;
        }
        // Легаси-выравнивание от execCommand в части браузеров: <p align="center">.
        if (name === 'align' && ['left', 'center', 'right', 'justify'].includes(String(value).toLowerCase())) {
          const align = String(value).toLowerCase();
          // Если style уже несёт text-align — не дублируем.
          if (!attrs.some((a) => a.startsWith('style="') && a.includes('text-align'))) {
            attrs.push(`style="text-align: ${align}"`);
          }
          continue;
        }
        if (name === 'data-promo' && tag === 'div') {
          const promo = String(value).replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, '').slice(0, 60);
          if (promo) attrs.push(`data-promo="${promo}"`);
          continue;
        }
        if ((tag === 'a' && name === 'href') || (tag === 'img' && name === 'src')) {
          if (!isSafeUrl(value)) continue;
          attrs.push(`${name}="${String(value).replace(/"/g, '&quot;')}"`);
          continue;
        }
        attrs.push(`${name}="${String(value).replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`);
      }
      if (tag === 'a') {
        // Ссылки только в новом окне.
        attrs.push('target="_blank"', 'rel="noopener noreferrer"');
      }
      if (tag === 'img') {
        // Картинки не ломают вёрстку.
        attrs.push('loading="lazy"', 'decoding="async"');
      }
      return attrs.length ? `<${tag} ${attrs.join(' ')}>` : `<${tag}>`;
    });

  let cleaned = result.trim();
  if (!cleaned) return null;

  // Картинки внутри текста: сжимаем в WebP (как иконки/обложки), чтобы
  // страница модалки не таскала мегабайты base64.
  const imgPattern = /<img[^>]*src="(data:image\/[^"]+)"[^>]*>/gi;
  const matches = [...cleaned.matchAll(imgPattern)];
  for (const match of matches) {
    const [fullTag, dataUrl] = match;
    const compressed = await compressDataImage(dataUrl);
    if (!compressed) continue;
    const replaced = fullTag.replace(dataUrl, compressed);
    cleaned = cleaned.replace(fullTag, replaced);
  }

  return cleaned.slice(0, MAX_HTML_BYTES);
}
