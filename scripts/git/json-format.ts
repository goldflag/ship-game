/** JSON text as the repository writes it, so a merge can rewrite a file byte-for-byte in its own style.
 * Numbers keep their source lexeme (Python writes `3.0`, JavaScript `3`) and are compared by it. */

export class RawNumber {
  constructor(readonly raw: string) {}
}
export type Json = null | boolean | number | RawNumber | string | Json[] | { [key: string]: Json };

const setKey = (object: { [key: string]: Json }, key: string, value: Json) =>
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });

/** Parse JSON text, keeping every number as its source lexeme. */
export function parseRaw(text: string): Json {
  let i = 0;
  const space = () => { while (i < text.length && ' \t\r\n'.includes(text[i])) i++; };
  const fail = (what: string): never => { throw new Error(`Invalid JSON at ${i}: ${what}`); };
  const string = () => {
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (text[i++] !== '"') fail('unterminated string');
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): Json => {
    space();
    const c = text[i];
    if (c === '{') {
      i++;
      const object: { [key: string]: Json } = {};
      space();
      if (text[i] === '}') { i++; return object; }
      for (;;) {
        space();
        if (text[i] !== '"') fail('expected a key');
        const key = string();
        space();
        if (text[i++] !== ':') fail('expected a colon');
        if (Object.hasOwn(object, key)) fail(`duplicate key ${key}`);
        setKey(object, key, value());
        space();
        if (text[i] === ',') { i++; continue; }
        if (text[i++] !== '}') fail('expected , or }');
        return object;
      }
    }
    if (c === '[') {
      i++;
      const array: Json[] = [];
      space();
      if (text[i] === ']') { i++; return array; }
      for (;;) {
        array.push(value());
        space();
        if (text[i] === ',') { i++; continue; }
        if (text[i++] !== ']') fail('expected , or ]');
        return array;
      }
    }
    if (c === '"') return string();
    for (const [word, literal] of [['true', true], ['false', false], ['null', null]] as const)
      if (text.startsWith(word, i)) { i += word.length; return literal; }
    const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    number.lastIndex = i;
    const match = number.exec(text);
    if (!match) fail('unexpected character');
    i += match![0].length;
    return new RawNumber(match![0]);
  };
  const result = value();
  space();
  if (i !== text.length) fail('trailing text');
  return result;
}

export const isObject = (v: unknown): v is { [key: string]: Json } =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RawNumber);

/** Compact JSON with source number lexemes; `ascii` escapes non-ASCII as Python's `ensure_ascii` does. */
function compact(value: Json, ascii: boolean): string {
  if (value instanceof RawNumber) return value.raw;
  if (typeof value === 'string') {
    const text = JSON.stringify(value);
    return ascii ? text.replace(/[\u0080-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) : text;
  }
  if (Array.isArray(value)) return '[' + value.map(v => compact(v, ascii)).join(',') + ']';
  if (isObject(value)) return '{' + Object.entries(value).map(([k, v]) => compact(k, ascii) + ':' + compact(v, ascii)).join(',') + '}';
  return JSON.stringify(value);
}

/** Two-space indented JSON, as `JSON.stringify(v, null, 2)` and Python's `json.dumps(v, indent=2)` write it. */
function indented(value: Json, ascii: boolean, depth: number): string {
  const pad = '  '.repeat(depth + 1), close = '  '.repeat(depth);
  if (Array.isArray(value)) return value.length ? '[\n' + value.map(v => pad + indented(v, ascii, depth + 1)).join(',\n') + '\n' + close + ']' : '[]';
  if (isObject(value)) {
    const entries = Object.entries(value);
    return entries.length ? '{\n' + entries.map(([k, v]) => pad + compact(k, ascii) + ': ' + indented(v, ascii, depth + 1)).join(',\n') + '\n' + close + '}' : '{}';
  }
  return compact(value, ascii);
}

/** One generated record per line, each after its own key line: Git merges two records' changes as separate
 * hunks only when an unchanged line lies between them. `recordsAt` names the object holding the records; the
 * rest of the document is indented as usual. */
function perRecord(value: Json, recordsAt: string[], depth = 0): string {
  const pad = '  '.repeat(depth + 1), close = '  '.repeat(depth);
  if (!isObject(value)) throw new Error('Per-record JSON needs an object');
  if (!recordsAt.length)
    return '{\n' + Object.entries(value).map(([k, v]) => pad + compact(k, false) + ':\n' + pad + '  ' + compact(v, false)).join(',\n') + '\n' + close + '}';
  return '{\n' + Object.entries(value).map(([k, v]) =>
    pad + compact(k, false) + ': ' + (k === recordsAt[0] ? perRecord(v, recordsAt.slice(1), depth + 1) : indented(v, false, depth + 1))).join(',\n') + '\n' + close + '}';
}

/** Write generated per-ship JSON (`recordsAt` locates the object keyed by ship ID). */
export function perRecordJson(value: unknown, recordsAt: string[] = []): string {
  return perRecord(parseRaw(JSON.stringify(value)), recordsAt) + '\n';
}

export type Style = { kind: 'indented'; ascii: boolean } | { kind: 'per-record'; recordsAt: string[] };
export function format(value: Json, style: Style): string {
  return (style.kind === 'indented' ? indented(value, style.ascii, 0) : perRecord(value, style.recordsAt)) + '\n';
}

const reproduces = (style: Style, text: string, value: Json) => { try { return format(value, style) === text; } catch { return false; } };

/** The repository style that reproduces `text` exactly, or undefined: a merge must not reformat a file.
 * When several do (an all-ASCII file fits either escaping), the first that also reproduces a tie-breaking
 * version wins. */
export function detectStyle(text: string, value: Json, ...others: { text: string; value: Json }[]): Style | undefined {
  const candidates: Style[] = [{ kind: 'indented', ascii: false }, { kind: 'indented', ascii: true }, { kind: 'per-record', recordsAt: [] }];
  if (isObject(value)) for (const [key, v] of Object.entries(value)) if (isObject(v)) candidates.push({ kind: 'per-record', recordsAt: [key] });
  const fits = candidates.filter(style => reproduces(style, text, value));
  for (const other of others) {
    const style = fits.find(style => reproduces(style, other.text, other.value));
    if (style) return style;
  }
  return fits[0];
}
