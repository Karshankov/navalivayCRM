import { HTMLParser } from 'telegram/extensions/html.js';
import { normalizeTelegramParseMode } from '../utils/telegram-message-format.js';

const TELEGRAM_HTML_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'code',
  'del',
  'em',
  'i',
  'pre',
  's',
  'spoiler',
  'strong',
  'tg-emoji',
  'u',
]);
const TELEGRAM_HTML_ATTRIBUTES = Object.freeze({
  a: new Set(['href']),
  blockquote: new Set(['expandable']),
  code: new Set(['class']),
  'tg-emoji': new Set(['emoji-id']),
});

function invalidHtml() {
  const error = new Error('invalid_html');
  error.code = 'invalid_html';
  return error;
}

function parseTagAttributes(token, nameLength) {
  const source = token.slice(1, -1);
  const attributes = new Map();
  let cursor = nameLength;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    if (cursor >= source.length || source[cursor] === '/') break;

    const nameMatch = source.slice(cursor).match(/^([A-Za-z_:][A-Za-z0-9_.:-]*)/);
    if (!nameMatch) throw invalidHtml();
    const name = nameMatch[1].toLowerCase();
    if (attributes.has(name)) throw invalidHtml();
    cursor += nameMatch[0].length;
    while (/\s/.test(source[cursor] || '')) cursor += 1;

    let value = null;
    if (source[cursor] === '=') {
      cursor += 1;
      while (/\s/.test(source[cursor] || '')) cursor += 1;
      const quote = source[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        const end = source.indexOf(quote, cursor);
        if (end < 0) throw invalidHtml();
        value = source.slice(cursor, end);
        cursor = end + 1;
      } else {
        const valueMatch = source.slice(cursor).match(/^([^\s"'=<>`]+)/);
        if (!valueMatch) throw invalidHtml();
        value = valueMatch[1];
        cursor += valueMatch[0].length;
      }
    }
    attributes.set(name, value);
  }
  if (source.slice(cursor).trim()) throw invalidHtml();
  return attributes;
}

function assertValidTagAttributes(name, attributes, openTags) {
  const allowed = TELEGRAM_HTML_ATTRIBUTES[name] || new Set();
  for (const attribute of attributes.keys()) {
    if (!allowed.has(attribute)) throw invalidHtml();
  }
  if (name === 'a' && !String(attributes.get('href') || '').trim()) throw invalidHtml();
  if (
    name === 'tg-emoji'
    && !/^\d+$/.test(String(attributes.get('emoji-id') || ''))
  ) {
    throw invalidHtml();
  }
  if (attributes.has('class')) {
    const className = String(attributes.get('class') || '');
    if (name !== 'code' || openTags.at(-1) !== 'pre' || !/^language-.+/.test(className)) {
      throw invalidHtml();
    }
  }
}

function assertValidTelegramHtml(source) {
  const openTags = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '<' || !/[A-Za-z/!?]/.test(source[index + 1] || '')) continue;

    let quote = null;
    let end = -1;
    for (let cursor = index + 1; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        end = cursor;
        break;
      }
    }
    if (end < 0) throw invalidHtml();

    const token = source.slice(index, end + 1);
    if (token.slice(1, -1).includes('<')) throw invalidHtml();
    const closing = token.match(/^<\/([A-Za-z][A-Za-z0-9-]*)\s*>$/);
    if (closing) {
      const name = closing[1].toLowerCase();
      if (!TELEGRAM_HTML_TAGS.has(name) || openTags.pop() !== name) {
        throw invalidHtml();
      }
      index = end;
      continue;
    }

    const opening = token.match(/^<([A-Za-z][A-Za-z0-9-]*)(?:\s+[\s\S]*?)?>$/);
    if (!opening) throw invalidHtml();
    const name = opening[1].toLowerCase();
    if (!TELEGRAM_HTML_TAGS.has(name) || openTags.includes(name)) throw invalidHtml();
    const attributes = parseTagAttributes(token, opening[1].length);
    assertValidTagAttributes(name, attributes, openTags);
    openTags.push(name);
    index = end;
  }
  if (openTags.length > 0) throw invalidHtml();
}

/**
 * Готовит параметры GramJS без его внутреннего разбора упоминаний.
 *
 * Если передать `parseMode: 'html'` прямо в sendMessage, GramJS попробует
 * превратить ссылки `@name`, `+phone` и `tg://user?id=...` в упоминания через
 * getInputEntity. Это может вызвать запрещённый contacts.ResolveUsername.
 * Поэтому HTML разбирается локально, а GramJS получает готовые entities.
 */
export function buildUserbotSendOptions(text, parseMode = null) {
  const source = String(text ?? '');
  const normalizedParseMode = normalizeTelegramParseMode(parseMode);
  if (!normalizedParseMode) {
    // У GramJS по умолчанию включён Markdown. Пустой список сущностей нужен,
    // чтобы ручной текст ушёл ровно таким, каким его ввёл менеджер.
    return { message: source, formattingEntities: [] };
  }

  let message;
  let formattingEntities;
  try {
    assertValidTelegramHtml(source);
    [message, formattingEntities] = HTMLParser.parse(source);
  } catch {
    throw invalidHtml();
  }
  if (!String(message ?? '').trim()) {
    throw invalidHtml();
  }

  return { message, formattingEntities };
}
