import { ExpressionError } from './ast.js';

export interface FunctionContext {
  /** Epoch milliseconds. Injected by the engine clock so replays are exact. */
  now: number;
}

export interface FunctionSpec {
  minArgs: number;
  /** `Infinity` for variadic functions. */
  maxArgs: number;
  signature: string;
  description: string;
  call: (args: unknown[], ctx: FunctionContext) => unknown;
}

const DAY_MS = 86_400_000;

function toNumber(value: unknown, fn: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new ExpressionError(`${fn}() expected a number but received ${describe(value)}`, 0);
}

/** Accepts an ISO-8601 string, a `Date`, or epoch milliseconds. */
function toEpoch(value: unknown, fn: string): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new ExpressionError(`${fn}() expected a date but received ${describe(value)}`, 0);
}

function toArray(value: unknown, fn: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  throw new ExpressionError(`${fn}() expected a list but received ${describe(value)}`, 0);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  return typeof value;
}

/** Reads a property without ever crossing into the prototype chain. */
function readKey(item: unknown, key: string): unknown {
  if (item === null || typeof item !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(item, key)) return undefined;
  return (item as Record<string, unknown>)[key];
}

/**
 * The complete function library available to workflow guards.
 *
 * Every entry is pure apart from the injected clock, so evaluating the same
 * expression against the same inputs always produces the same answer — which is
 * what makes a recorded pathway run replayable for audit.
 */
export const FUNCTIONS: Record<string, FunctionSpec> = {
  now: {
    minArgs: 0,
    maxArgs: 0,
    signature: 'now()',
    description: 'Current time as epoch milliseconds, taken from the engine clock.',
    call: (_args, ctx) => ctx.now,
  },
  age: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'age(birthDate)',
    description: 'Whole years elapsed since a birth date.',
    call: (args, ctx) => {
      const birth = new Date(toEpoch(args[0], 'age'));
      const today = new Date(ctx.now);
      let years = today.getUTCFullYear() - birth.getUTCFullYear();
      const monthDelta = today.getUTCMonth() - birth.getUTCMonth();
      if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < birth.getUTCDate())) {
        years -= 1;
      }
      return years;
    },
  },
  daysSince: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'daysSince(date)',
    description: 'Days between a past date and now. Negative for future dates.',
    call: (args, ctx) => (ctx.now - toEpoch(args[0], 'daysSince')) / DAY_MS,
  },
  daysUntil: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'daysUntil(date)',
    description: 'Days between now and a future date. Negative for past dates.',
    call: (args, ctx) => (toEpoch(args[0], 'daysUntil') - ctx.now) / DAY_MS,
  },
  within: {
    minArgs: 2,
    maxArgs: 2,
    signature: 'within(date, days)',
    description: 'True when a date falls inside the given number of days of now.',
    call: (args, ctx) =>
      Math.abs(ctx.now - toEpoch(args[0], 'within')) <= toNumber(args[1], 'within') * DAY_MS,
  },
  exists: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'exists(value)',
    description: 'True when a value is neither null nor missing.',
    call: (args) => args[0] !== null && args[0] !== undefined,
  },
  isEmpty: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'isEmpty(value)',
    description: 'True for null, missing values, empty text and empty lists.',
    call: (args) => {
      const value = args[0];
      if (value === null || value === undefined) return true;
      if (typeof value === 'string') return value.trim() === '';
      if (Array.isArray(value)) return value.length === 0;
      return false;
    },
  },
  count: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'count(list)',
    description: 'Number of items in a list.',
    call: (args) => toArray(args[0], 'count').length,
  },
  contains: {
    minArgs: 2,
    maxArgs: 2,
    signature: 'contains(listOrText, value)',
    description: 'Membership test for a list, or substring test for text.',
    call: (args) => {
      const [collection, value] = args;
      if (typeof collection === 'string') return collection.includes(String(value));
      return toArray(collection, 'contains').some((item) => item === value);
    },
  },
  first: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'first(list)',
    description: 'First item of a list, or null when empty.',
    call: (args) => toArray(args[0], 'first')[0] ?? null,
  },
  last: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'last(list)',
    description: 'Last item of a list, or null when empty.',
    call: (args) => {
      const list = toArray(args[0], 'last');
      return list.length === 0 ? null : (list[list.length - 1] ?? null);
    },
  },
  pluck: {
    minArgs: 2,
    maxArgs: 2,
    signature: 'pluck(list, key)',
    description: 'Extracts one field from every item in a list.',
    call: (args) => toArray(args[0], 'pluck').map((item) => readKey(item, String(args[1])) ?? null),
  },
  where: {
    minArgs: 3,
    maxArgs: 3,
    signature: 'where(list, key, value)',
    description: 'Keeps the items whose field equals a value.',
    call: (args) => toArray(args[0], 'where').filter((item) => readKey(item, String(args[1])) === args[2]),
  },
  latest: {
    minArgs: 1,
    maxArgs: 2,
    signature: 'latest(list, dateKey?)',
    description: 'The most recent item in a list, by `effectiveDateTime` unless told otherwise.',
    call: (args) => {
      const list = toArray(args[0], 'latest');
      const key = args.length > 1 ? String(args[1]) : 'effectiveDateTime';
      let best: unknown = null;
      let bestAt = Number.NEGATIVE_INFINITY;
      for (const item of list) {
        const raw = readKey(item, key);
        if (raw === undefined || raw === null) continue;
        const at = toEpoch(raw, 'latest');
        if (at > bestAt) {
          bestAt = at;
          best = item;
        }
      }
      return best;
    },
  },
  sum: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'sum(list)',
    description: 'Adds every number in a list.',
    call: (args) => toArray(args[0], 'sum').reduce<number>((total, item) => total + toNumber(item, 'sum'), 0),
  },
  avg: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'avg(list)',
    description: 'Mean of a list of numbers, or null when empty.',
    call: (args) => {
      const list = toArray(args[0], 'avg');
      if (list.length === 0) return null;
      return list.reduce<number>((total, item) => total + toNumber(item, 'avg'), 0) / list.length;
    },
  },
  min: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    signature: 'min(a, b, ...)',
    description: 'Smallest of the given numbers, or of a single list.',
    call: (args) => {
      const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      return Math.min(...values.map((item) => toNumber(item, 'min')));
    },
  },
  max: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    signature: 'max(a, b, ...)',
    description: 'Largest of the given numbers, or of a single list.',
    call: (args) => {
      const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      return Math.max(...values.map((item) => toNumber(item, 'max')));
    },
  },
  abs: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'abs(number)',
    description: 'Absolute value.',
    call: (args) => Math.abs(toNumber(args[0], 'abs')),
  },
  round: {
    minArgs: 1,
    maxArgs: 2,
    signature: 'round(number, decimals?)',
    description: 'Rounds to the given number of decimal places, default zero.',
    call: (args) => {
      const factor = 10 ** (args.length > 1 ? toNumber(args[1], 'round') : 0);
      return Math.round(toNumber(args[0], 'round') * factor) / factor;
    },
  },
  coalesce: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    signature: 'coalesce(a, b, ...)',
    description: 'First argument that is neither null nor missing.',
    call: (args) => args.find((item) => item !== null && item !== undefined) ?? null,
  },
  lower: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'lower(text)',
    description: 'Lowercased text.',
    call: (args) => String(args[0] ?? '').toLowerCase(),
  },
  upper: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'upper(text)',
    description: 'Uppercased text.',
    call: (args) => String(args[0] ?? '').toUpperCase(),
  },
  matches: {
    minArgs: 2,
    maxArgs: 2,
    signature: 'matches(text, fragment)',
    description:
      'Case-insensitive substring test. Deliberately not a regular expression, so a guard cannot be made to backtrack.',
    call: (args) =>
      String(args[0] ?? '')
        .toLowerCase()
        .includes(String(args[1] ?? '').toLowerCase()),
  },
};

export const FUNCTION_NAMES: readonly string[] = Object.keys(FUNCTIONS).sort();

/**
 * Looks up a function by name, own properties only.
 *
 * Indexing `FUNCTIONS` directly would resolve `constructor` and `__proto__` to
 * inherited members of Object.prototype, handing an expression a callable it was
 * never meant to reach. Every call site goes through here.
 */
export function getFunction(name: string): FunctionSpec | undefined {
  return Object.prototype.hasOwnProperty.call(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
}
