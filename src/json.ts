import { failure } from './errors.js';

/** Internal RFC 8259 numeric token. DTOs must explicitly check unit and range. */
export class JsonNumber {
  constructor(readonly text: string) {
    Object.freeze(this);
  }
}
export type Json = null | boolean | string | JsonNumber | Json[] | { [key: string]: Json };

export function protocolError() {
  return failure('PROTOCOL_MISMATCH', 'transport', 'configure', 'Invalid JSON-RPC response.');
}

const MAX_DEPTH = 64;

/** Whether the engine passes the source text of primitives to JSON.parse revivers. */
function detectSourceText(): boolean {
  try {
    let source: unknown;
    JSON.parse('1', (_key: string, value: unknown, context?: { source?: unknown }) => {
      source = context?.source;
      return value;
    });
    return source === '1';
  } catch {
    return false;
  }
}
const nativeSourceText = detectSourceText();

function parseNative(input: string): Json {
  function checkDepth(value: Json, depth: number): void {
    if (value === null || typeof value !== 'object' || value instanceof JsonNumber) return;
    if (depth >= MAX_DEPTH) throw protocolError();
    if (!Array.isArray(value)) Object.setPrototypeOf(value, null);
    for (const child of Object.values(value)) checkDepth(child, depth + 1);
  }
  const result: Json = JSON.parse(input, (_key: string, value: unknown, context?: { source: string }) => {
    if (typeof value !== 'number') return value;
    if (typeof context?.source !== 'string') throw protocolError();
    return new JsonNumber(context.source);
  });
  checkDepth(result, 0);
  return result;
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f]/;

/** Strict RFC 8259 parser producing the same shapes as the native path. */
function parseFallback(input: string): Json {
  let at = 0;
  const fail = (): never => {
    throw protocolError();
  };
  const space = () => {
    for (;;) {
      const c = input.charCodeAt(at);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) at++;
      else return;
    }
  };
  // Find the closing quote without a backtracking regex (strings can be megabytes).
  const string = (): string => {
    let end = at;
    for (;;) {
      end = input.indexOf('"', end + 1);
      if (end < 0) return fail();
      let slashes = 0;
      while (input.charCodeAt(end - 1 - slashes) === 0x5c) slashes++;
      if (slashes % 2 === 0) break;
    }
    const token = input.slice(at, end + 1);
    at = end + 1;
    // JSON.parse validates escapes and rejects unescaped control characters.
    if (token.includes('\\')) return JSON.parse(token) as string;
    if (CONTROL.test(token)) return fail();
    return token.slice(1, -1);
  };
  const value = (depth: number): Json => {
    space();
    const c = input[at];
    if (c === '"') return string();
    if (c === '{' || c === '[') {
      if (depth >= MAX_DEPTH) fail();
      at++;
      space();
      if (c === '[') {
        const array: Json[] = [];
        if (input[at] === ']') {
          at++;
          return array;
        }
        for (;;) {
          array.push(value(depth + 1));
          space();
          const next = input[at++];
          if (next === ']') return array;
          if (next !== ',') fail();
        }
      }
      const object = Object.create(null) as { [key: string]: Json };
      if (input[at] === '}') {
        at++;
        return object;
      }
      for (;;) {
        space();
        if (input[at] !== '"') fail();
        const key = string();
        space();
        if (input[at++] !== ':') fail();
        // Null-prototype objects store "__proto__" as an ordinary own property.
        object[key] = value(depth + 1);
        space();
        const next = input[at++];
        if (next === '}') return object;
        if (next !== ',') fail();
      }
    }
    if (input.startsWith('true', at)) {
      at += 4;
      return true;
    }
    if (input.startsWith('false', at)) {
      at += 5;
      return false;
    }
    if (input.startsWith('null', at)) {
      at += 4;
      return null;
    }
    NUMBER.lastIndex = at;
    const number = NUMBER.exec(input);
    if (!number) return fail();
    at += number[0].length;
    return new JsonNumber(number[0]);
  };
  const result = value(0);
  space();
  if (at !== input.length) fail();
  return result;
}

/** JSON parsing with exact numeric tokens, null-prototype objects, last-key-wins
 * semantics and a 64-container nesting limit. Uses JSON.parse reviver source text
 * when the engine supports it, and an equivalent strict parser otherwise.
 */
export function parseJson(input: string, options: { fallback?: boolean } = {}): Json {
  try {
    return nativeSourceText && !options.fallback ? parseNative(input) : parseFallback(input);
  } catch {
    throw protocolError();
  }
}
