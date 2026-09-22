import { ExpressionError } from './ast.js';

export type TokenType = 'number' | 'string' | 'identifier' | 'punct' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  at: number;
}

/** Multi-character operators, longest first so that `<=` wins over `<`. */
const PUNCTUATION = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '(',
  ')',
  '[',
  ']',
  '.',
  ',',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '!',
] as const;

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isIdentStart = (c: string): boolean =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

/**
 * Converts source text into a flat token list. Rejects any character outside
 * the grammar rather than skipping it, so typos surface at authoring time
 * instead of silently changing a clinical condition's meaning.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i] as string;

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i += 1;
      continue;
    }

    if (isDigit(char)) {
      const start = i;
      while (i < source.length && isDigit(source[i] as string)) i += 1;
      if (source[i] === '.' && isDigit(source[i + 1] ?? '')) {
        i += 1;
        while (i < source.length && isDigit(source[i] as string)) i += 1;
      }
      tokens.push({ type: 'number', value: source.slice(start, i), at: start });
      continue;
    }

    if (char === '"' || char === "'") {
      const start = i;
      const quote = char;
      i += 1;
      let value = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          const next = source[i + 1];
          if (next === undefined) break;
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
          continue;
        }
        value += source[i];
        i += 1;
      }
      if (source[i] !== quote) {
        throw new ExpressionError('Unterminated string literal', start, source);
      }
      i += 1;
      tokens.push({ type: 'string', value, at: start });
      continue;
    }

    if (isIdentStart(char)) {
      const start = i;
      while (i < source.length && isIdentPart(source[i] as string)) i += 1;
      tokens.push({ type: 'identifier', value: source.slice(start, i), at: start });
      continue;
    }

    const punct = PUNCTUATION.find((p) => source.startsWith(p, i));
    if (punct) {
      tokens.push({ type: 'punct', value: punct, at: i });
      i += punct.length;
      continue;
    }

    throw new ExpressionError(`Unexpected character ${JSON.stringify(char)}`, i, source);
  }

  tokens.push({ type: 'eof', value: '', at: source.length });
  return tokens;
}
