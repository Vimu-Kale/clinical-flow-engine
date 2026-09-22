import type { BinaryOperator, Expr } from './ast.js';
import { ExpressionError } from './ast.js';
import { parse } from './parser.js';
import { getFunction, type FunctionContext } from './functions.js';

/** Property names that would expose the prototype chain. Never readable. */
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type Scope = Record<string, unknown>;

export interface EvaluateOptions {
  scope: Scope;
  /** Epoch milliseconds used by `now()` and every date helper. */
  now?: number;
}

/** Reads a property, refusing prototype access and tolerating missing values. */
function readProperty(object: unknown, key: string, at: number, source: string | undefined): unknown {
  if (BLOCKED_KEYS.has(key)) {
    throw new ExpressionError(`Access to "${key}" is not permitted`, at, source);
  }
  if (object === null || object === undefined) return undefined;

  if (Array.isArray(object)) {
    if (key === 'length') return object.length;
    const index = Number(key);
    return Number.isInteger(index) ? object[index] : undefined;
  }

  if (typeof object === 'string') {
    return key === 'length' ? object.length : undefined;
  }

  if (typeof object !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(object, key)) return undefined;
  return (object as Record<string, unknown>)[key];
}

function asNumber(value: unknown, operator: string, at: number, source: string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  throw new ExpressionError(
    `Operator "${operator}" needs a number but received ${value === undefined ? 'nothing' : JSON.stringify(value)}`,
    at,
    source,
  );
}

/** Dates are ordered by instant; everything else falls back to its own order. */
function compare(left: unknown, right: unknown, operator: string, at: number, source: string | undefined): number {
  if (typeof left === 'string' && typeof right === 'string') {
    const leftAt = Date.parse(left);
    const rightAt = Date.parse(right);
    if (!Number.isNaN(leftAt) && !Number.isNaN(rightAt)) return leftAt - rightAt;
    if (Number.isNaN(Number(left)) || Number.isNaN(Number(right))) {
      return left < right ? -1 : left > right ? 1 : 0;
    }
  }
  return asNumber(left, operator, at, source) - asNumber(right, operator, at, source);
}

function applyBinary(
  operator: BinaryOperator,
  left: unknown,
  right: unknown,
  at: number,
  source: string | undefined,
): unknown {
  switch (operator) {
    case '==':
      return left === null || left === undefined ? right === null || right === undefined : left === right;
    case '!=':
      return !(left === null || left === undefined
        ? right === null || right === undefined
        : left === right);
    case '<':
      return compare(left, right, operator, at, source) < 0;
    case '<=':
      return compare(left, right, operator, at, source) <= 0;
    case '>':
      return compare(left, right, operator, at, source) > 0;
    case '>=':
      return compare(left, right, operator, at, source) >= 0;
    case 'in':
      if (typeof right === 'string') return right.includes(String(left));
      if (Array.isArray(right)) return right.some((item) => item === left);
      throw new ExpressionError('Operator "in" needs a list or text on the right', at, source);
    case '+':
      if (typeof left === 'string' || typeof right === 'string') return `${String(left)}${String(right)}`;
      return asNumber(left, operator, at, source) + asNumber(right, operator, at, source);
    case '-':
      return asNumber(left, operator, at, source) - asNumber(right, operator, at, source);
    case '*':
      return asNumber(left, operator, at, source) * asNumber(right, operator, at, source);
    case '/': {
      const divisor = asNumber(right, operator, at, source);
      if (divisor === 0) throw new ExpressionError('Division by zero', at, source);
      return asNumber(left, operator, at, source) / divisor;
    }
    case '%': {
      const divisor = asNumber(right, operator, at, source);
      if (divisor === 0) throw new ExpressionError('Modulo by zero', at, source);
      return asNumber(left, operator, at, source) % divisor;
    }
  }
}

function evaluateNode(expr: Expr, scope: Scope, ctx: FunctionContext, source: string | undefined): unknown {
  switch (expr.type) {
    case 'Literal':
      return expr.value;

    case 'Identifier':
      if (BLOCKED_KEYS.has(expr.name)) {
        throw new ExpressionError(`Access to "${expr.name}" is not permitted`, expr.at, source);
      }
      if (!Object.prototype.hasOwnProperty.call(scope, expr.name)) {
        throw new ExpressionError(`Unknown variable "${expr.name}"`, expr.at, source);
      }
      return scope[expr.name];

    case 'Member':
      return readProperty(evaluateNode(expr.object, scope, ctx, source), expr.property, expr.at, source);

    case 'Index': {
      const key = evaluateNode(expr.index, scope, ctx, source);
      return readProperty(evaluateNode(expr.object, scope, ctx, source), String(key), expr.at, source);
    }

    case 'Call': {
      const spec = getFunction(expr.callee);
      if (!spec) {
        throw new ExpressionError(`Unknown function "${expr.callee}"`, expr.at, source);
      }
      if (expr.args.length < spec.minArgs || expr.args.length > spec.maxArgs) {
        throw new ExpressionError(
          `${spec.signature} takes ${describeArity(spec.minArgs, spec.maxArgs)} but received ${expr.args.length}`,
          expr.at,
          source,
        );
      }
      const args = expr.args.map((arg) => evaluateNode(arg, scope, ctx, source));
      try {
        return spec.call(args, ctx);
      } catch (error) {
        if (error instanceof ExpressionError) {
          throw new ExpressionError(error.message, expr.at, source);
        }
        throw error;
      }
    }

    case 'Unary':
      if (expr.operator === '!') return !evaluateNode(expr.argument, scope, ctx, source);
      return -asNumber(evaluateNode(expr.argument, scope, ctx, source), '-', expr.at, source);

    case 'Binary':
      return applyBinary(
        expr.operator,
        evaluateNode(expr.left, scope, ctx, source),
        evaluateNode(expr.right, scope, ctx, source),
        expr.at,
        source,
      );

    case 'Logical': {
      const left = evaluateNode(expr.left, scope, ctx, source);
      if (expr.operator === '&&') {
        return left ? evaluateNode(expr.right, scope, ctx, source) : left;
      }
      return left ? left : evaluateNode(expr.right, scope, ctx, source);
    }

    case 'ArrayLiteral':
      return expr.elements.map((element) => evaluateNode(element, scope, ctx, source));
  }
}

function describeArity(min: number, max: number): string {
  if (min === max) return `${min} argument${min === 1 ? '' : 's'}`;
  if (max === Number.POSITIVE_INFINITY) return `at least ${min} argument${min === 1 ? '' : 's'}`;
  return `${min} to ${max} arguments`;
}

/** A parsed expression, ready to run many times without re-parsing. */
export interface CompiledExpression {
  readonly source: string;
  readonly ast: Expr;
  evaluate(options: EvaluateOptions): unknown;
  /**
   * Evaluates and insists on a genuine boolean. A guard that produces a number
   * or a string is an authoring mistake — in a care pathway, silently treating
   * `count(alerts)` as "true" is exactly the class of bug that must not reach a
   * patient — so it fails loudly instead of being coerced.
   */
  evaluateBoolean(options: EvaluateOptions): boolean;
}

/** Parses once and returns a reusable evaluator. */
export function compile(source: string): CompiledExpression {
  const ast = parse(source);
  return {
    source,
    ast,
    evaluate({ scope, now }) {
      return evaluateNode(ast, scope, { now: now ?? Date.now() }, source);
    },
    evaluateBoolean({ scope, now }) {
      const result = evaluateNode(ast, scope, { now: now ?? Date.now() }, source);
      if (typeof result !== 'boolean') {
        throw new ExpressionError(
          `Condition must evaluate to true or false, but produced ${result === undefined ? 'nothing' : JSON.stringify(result)}. Write an explicit comparison.`,
          0,
          source,
        );
      }
      return result;
    },
  };
}

/** Convenience wrapper that compiles and evaluates in one step. */
export function evaluate(source: string, options: EvaluateOptions): unknown {
  return compile(source).evaluate(options);
}

/** Convenience wrapper for guards. See `CompiledExpression.evaluateBoolean`. */
export function evaluateBoolean(source: string, options: EvaluateOptions): boolean {
  return compile(source).evaluateBoolean(options);
}
