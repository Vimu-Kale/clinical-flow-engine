import { describe, expect, it } from 'vitest';
import {
  collectReferences,
  compile,
  evaluate,
  evaluateBoolean,
  ExpressionError,
  parse,
  tokenize,
} from '@clinical-flow/expression';

const NOW = Date.parse('2026-03-15T09:00:00.000Z');
const run = (source: string, scope: Record<string, unknown> = {}) => evaluate(source, { scope, now: NOW });
const truth = (source: string, scope: Record<string, unknown> = {}) =>
  evaluateBoolean(source, { scope, now: NOW });

describe('lexer', () => {
  it('tokenises numbers, strings, identifiers and operators', () => {
    const kinds = tokenize('a.b >= 1.5 && c != "x"').map((token) => token.type);
    expect(kinds).toEqual([
      'identifier', 'punct', 'identifier', 'punct', 'number', 'punct', 'identifier', 'punct', 'string', 'eof',
    ]);
  });

  it('handles escapes inside strings', () => {
    expect(run('"a\\nb"')).toBe('a\nb');
  });

  it('rejects an unterminated string', () => {
    expect(() => tokenize('"oops')).toThrow(ExpressionError);
  });

  it('rejects a character outside the grammar', () => {
    expect(() => tokenize('a # b')).toThrow(/Unexpected character/);
  });
});

describe('arithmetic and comparison', () => {
  it('respects operator precedence', () => {
    expect(run('2 + 3 * 4')).toBe(14);
    expect(run('(2 + 3) * 4')).toBe(20);
    expect(run('10 - 2 - 3')).toBe(5);
    expect(run('7 % 4')).toBe(3);
  });

  it('compares numbers and orders ISO dates by instant', () => {
    expect(run('3 > 2')).toBe(true);
    expect(run('"2026-01-02T00:00:00Z" > "2026-01-01T00:00:00Z"')).toBe(true);
    expect(run('"2026-01-01T00:00:00Z" <= "2026-01-01T00:00:00Z"')).toBe(true);
  });

  it('treats null and undefined as equal to each other', () => {
    expect(run('a == null', { a: null })).toBe(true);
    expect(run('a == null', { a: undefined })).toBe(true);
    expect(run('a != null', { a: 0 })).toBe(true);
  });

  it('concatenates when either side of + is text', () => {
    expect(run('"dose: " + 5')).toBe('dose: 5');
  });

  it('supports membership for lists and text', () => {
    expect(run('"E11.9" in codes', { codes: ['E11.9', 'I10'] })).toBe(true);
    expect(run('"abc" in "xxabcxx"')).toBe(true);
  });

  it('refuses division by zero rather than returning Infinity', () => {
    expect(() => run('1 / 0')).toThrow(/Division by zero/);
    expect(() => run('1 % 0')).toThrow(/Modulo by zero/);
  });

  it('refuses arithmetic on values that are not numbers', () => {
    expect(() => run('a * 2', { a: {} })).toThrow(/needs a number/);
  });
});

describe('logic', () => {
  it('short-circuits and accepts word operators', () => {
    expect(run('false && boom', { boom: 1 })).toBe(false);
    expect(run('true or boom', { boom: 1 })).toBe(true);
    expect(run('not false')).toBe(true);
    expect(run('1 == 1 and 2 == 2')).toBe(true);
  });

  it('binds comparison tighter than conjunction', () => {
    expect(run('1 < 2 && 3 < 4')).toBe(true);
  });
});

describe('data access', () => {
  const scope = {
    patient: { name: 'Marcus Webb', birthDate: '1957-11-02' },
    observations: [
      { code: 'a', effectiveDateTime: '2026-01-01T00:00:00Z', valueQuantity: { value: 1 } },
      { code: 'b', effectiveDateTime: '2026-03-01T00:00:00Z', valueQuantity: { value: 9 } },
    ],
  };

  it('reads nested properties and array indexes', () => {
    expect(run('patient.name', scope)).toBe('Marcus Webb');
    expect(run('observations[1].valueQuantity.value', scope)).toBe(9);
    expect(run('observations.length', scope)).toBe(2);
  });

  it('returns nothing for a missing property instead of throwing', () => {
    expect(run('patient.missing', scope)).toBeUndefined();
    expect(run('patient.missing.deeper', scope)).toBeUndefined();
  });

  it('builds array literals', () => {
    expect(run('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('throws for a variable that is not in scope', () => {
    expect(() => run('missingVariable')).toThrow(/Unknown variable/);
  });
});

describe('sandbox', () => {
  it('refuses to read prototype plumbing', () => {
    expect(() => run('x.__proto__', { x: {} })).toThrow(/not permitted/);
    expect(() => run('x.constructor', { x: {} })).toThrow(/not permitted/);
    expect(() => run('__proto__', {})).toThrow(/not permitted/);
  });

  it('refuses method-shaped calls at parse time', () => {
    expect(() => parse('patient.constructor("return 1")')).toThrow(/Only named functions can be called/);
    expect(() => parse('x.toString()')).toThrow(/Only named functions can be called/);
  });

  it('only reads own properties, never inherited ones', () => {
    expect(run('x.hasOwnProperty', { x: {} })).toBeUndefined();
  });

  it('does not resolve inherited object members as callable functions', () => {
    // Indexing a plain object would hand these back from Object.prototype.
    expect(() => run('constructor("return 1")')).toThrow(/Unknown function/);
    expect(() => run('__proto__(1)')).toThrow(/Unknown function/);
    expect(() => run('hasOwnProperty("x")')).toThrow(/Unknown function/);
    expect(() => run('valueOf()')).toThrow(/Unknown function/);
  });

  it('does not treat a prototype key as a word operator', () => {
    expect(() => run('1 __proto__ 2')).toThrow(ExpressionError);
  });

  it('rejects unknown functions and wrong argument counts', () => {
    expect(() => run('nope(1)')).toThrow(/Unknown function/);
    expect(() => run('abs()')).toThrow(/takes 1 argument/);
    expect(() => run('abs(1, 2)')).toThrow(/takes 1 argument/);
  });
});

describe('guards must be boolean', () => {
  it('accepts a real boolean', () => {
    expect(truth('1 < 2')).toBe(true);
  });

  it('rejects a number, rather than silently coercing it', () => {
    expect(() => truth('count(xs)', { xs: [1, 2] })).toThrow(/must evaluate to true or false/);
    expect(() => truth('"text"')).toThrow(/must evaluate to true or false/);
  });
});

describe('clinical functions', () => {
  it('computes age in whole years from the injected clock', () => {
    expect(run('age("1957-11-02")')).toBe(68);
    expect(run('age("2026-03-14")')).toBe(0);
  });

  it('measures elapsed and remaining days', () => {
    expect(run('daysSince("2026-03-05T09:00:00Z")')).toBe(10);
    expect(run('daysUntil("2026-03-25T09:00:00Z")')).toBe(10);
    expect(run('within("2026-03-10T09:00:00Z", 7)')).toBe(true);
    expect(run('within("2026-01-10T09:00:00Z", 7)')).toBe(false);
  });

  it('answers presence questions', () => {
    expect(run('exists(a)', { a: null })).toBe(false);
    expect(run('exists(a)', { a: 0 })).toBe(true);
    expect(run('isEmpty(a)', { a: [] })).toBe(true);
    expect(run('isEmpty(a)', { a: "  " })).toBe(true);
    expect(run('isEmpty(a)', { a: 5 })).toBe(false);
  });

  it('works over lists', () => {
    const xs = [
      { code: 'a', effectiveDateTime: '2026-01-01T00:00:00Z', value: 1 },
      { code: 'b', effectiveDateTime: '2026-03-01T00:00:00Z', value: 9 },
    ];
    expect(run('count(xs)', { xs })).toBe(2);
    expect(run('count(xs)', { xs: null })).toBe(0);
    expect(run('pluck(xs, "code")', { xs })).toEqual(['a', 'b']);
    expect(run('count(where(xs, "code", "b"))', { xs })).toBe(1);
    expect(run('latest(xs).code', { xs })).toBe('b');
    expect(run('first(xs).code', { xs })).toBe('a');
    expect(run('last(xs).code', { xs })).toBe('b');
    expect(run('first(empty)', { empty: [] })).toBeNull();
    expect(run('last(empty)', { empty: [] })).toBeNull();
    expect(run('sum(ns)', { ns: [1, 2, 3] })).toBe(6);
    expect(run('avg(ns)', { ns: [2, 4] })).toBe(3);
    expect(run('avg(ns)', { ns: [] })).toBeNull();
    expect(run('contains(ns, 2)', { ns: [1, 2] })).toBe(true);
  });

  it('handles numbers and text', () => {
    expect(run('min(3, 1, 2)')).toBe(1);
    expect(run('max(ns)', { ns: [3, 1, 2] })).toBe(3);
    expect(run('abs(0 - 4)')).toBe(4);
    expect(run('round(2.345, 2)')).toBe(2.35);
    expect(run('round(2.6)')).toBe(3);
    expect(run('coalesce(a, b, 7)', { a: null, b: undefined })).toBe(7);
    expect(run('lower("AB")')).toBe('ab');
    expect(run('upper("ab")')).toBe('AB');
    expect(run('matches("Chest X-Ray", "x-ray")')).toBe(true);
  });

  it('reports the function name when an argument has the wrong type', () => {
    expect(() => run('age(a)', { a: {} })).toThrow(/age\(\) expected a date/);
    expect(() => run('count(a)', { a: 5 })).toThrow(/count\(\) expected a list/);
  });
});

describe('compilation and analysis', () => {
  it('reuses a parsed expression across evaluations', () => {
    const compiled = compile('a + 1');
    expect(compiled.evaluate({ scope: { a: 1 }, now: NOW })).toBe(2);
    expect(compiled.evaluate({ scope: { a: 5 }, now: NOW })).toBe(6);
    expect(compiled.source).toBe('a + 1');
  });

  it('collects the root variables an expression reads, ignoring function names', () => {
    const refs = collectReferences(parse('max(lactate, systolicBp) > threshold && [x][0] == 1'));
    expect([...refs].sort()).toEqual(['lactate', 'systolicBp', 'threshold', 'x']);
  });

  it('formats a syntax error with a caret', () => {
    try {
      parse('1 +');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      expect((error as ExpressionError).format()).toContain('^');
    }
  });

  it('rejects trailing input', () => {
    expect(() => parse('1 2')).toThrow(/after end of expression/);
  });
});
