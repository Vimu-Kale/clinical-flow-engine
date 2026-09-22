import type { BinaryOperator, Expr, LogicalOperator } from './ast.js';
import { ExpressionError } from './ast.js';
import { tokenize, type Token } from './lexer.js';

/**
 * Word forms accepted as aliases for symbolic operators.
 *
 * A Map rather than an object literal on purpose: `'__proto__' in {}` is true,
 * which would let a prototype key masquerade as an operator.
 */
const WORD_OPERATORS = new Map<string, string>([
  ['and', '&&'],
  ['or', '||'],
  ['not', '!'],
]);

const COMPARISON_OPERATORS = new Set<string>(['==', '!=', '<', '<=', '>', '>=', 'in']);

/**
 * Recursive-descent parser producing a read-only expression tree.
 *
 * Precedence, loosest to tightest: `||`, `&&`, comparison, `+ -`, `* / %`,
 * unary, postfix (member / index / call).
 */
class Parser {
  private readonly tokens: Token[];
  private readonly source: string;
  private position = 0;

  constructor(source: string) {
    this.source = source;
    this.tokens = tokenize(source);
  }

  parse(): Expr {
    const expr = this.parseLogicalOr();
    const token = this.peek();
    if (token.type !== 'eof') {
      throw this.error(`Unexpected ${this.describe(token)} after end of expression`, token.at);
    }
    return expr;
  }

  private parseLogicalOr(): Expr {
    let left = this.parseLogicalAnd();
    while (this.matchOperator('||')) {
      const at = this.previous().at;
      const right = this.parseLogicalAnd();
      left = { type: 'Logical', operator: '||' as LogicalOperator, left, right, at };
    }
    return left;
  }

  private parseLogicalAnd(): Expr {
    let left = this.parseComparison();
    while (this.matchOperator('&&')) {
      const at = this.previous().at;
      const right = this.parseComparison();
      left = { type: 'Logical', operator: '&&' as LogicalOperator, left, right, at };
    }
    return left;
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    for (;;) {
      const operator = this.peekOperator();
      if (operator === undefined || !COMPARISON_OPERATORS.has(operator)) break;
      const at = this.advance().at;
      const right = this.parseAdditive();
      left = { type: 'Binary', operator: operator as BinaryOperator, left, right, at };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    for (;;) {
      const operator = this.peekOperator();
      if (operator !== '+' && operator !== '-') break;
      const at = this.advance().at;
      const right = this.parseMultiplicative();
      left = { type: 'Binary', operator, left, right, at };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    for (;;) {
      const operator = this.peekOperator();
      if (operator !== '*' && operator !== '/' && operator !== '%') break;
      const at = this.advance().at;
      const right = this.parseUnary();
      left = { type: 'Binary', operator, left, right, at };
    }
    return left;
  }

  private parseUnary(): Expr {
    const operator = this.peekOperator();
    if (operator === '!' || operator === '-') {
      const at = this.advance().at;
      return { type: 'Unary', operator, argument: this.parseUnary(), at };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    for (;;) {
      if (this.matchPunct('.')) {
        const at = this.previous().at;
        const name = this.advance();
        if (name.type !== 'identifier') {
          throw this.error(`Expected a property name after "."`, name.at);
        }
        expr = { type: 'Member', object: expr, property: name.value, at };
        continue;
      }

      if (this.matchPunct('[')) {
        const at = this.previous().at;
        const index = this.parseLogicalOr();
        this.expectPunct(']');
        expr = { type: 'Index', object: expr, index, at };
        continue;
      }

      if (this.checkPunct('(')) {
        // Only bare identifiers are callable. `patient.constructor(...)` and any
        // other method-shaped call is rejected here, not at evaluation time.
        if (expr.type !== 'Identifier') {
          throw this.error(
            'Only named functions can be called; method calls are not supported',
            this.peek().at,
          );
        }
        const at = this.advance().at;
        const args: Expr[] = [];
        if (!this.checkPunct(')')) {
          do {
            args.push(this.parseLogicalOr());
          } while (this.matchPunct(','));
        }
        this.expectPunct(')');
        expr = { type: 'Call', callee: expr.name, args, at };
        continue;
      }

      return expr;
    }
  }

  private parsePrimary(): Expr {
    const token = this.advance();

    if (token.type === 'number') {
      return { type: 'Literal', value: Number(token.value) };
    }

    if (token.type === 'string') {
      return { type: 'Literal', value: token.value };
    }

    if (token.type === 'identifier') {
      if (token.value === 'true') return { type: 'Literal', value: true };
      if (token.value === 'false') return { type: 'Literal', value: false };
      if (token.value === 'null') return { type: 'Literal', value: null };
      if (WORD_OPERATORS.has(token.value)) {
        throw this.error(`Unexpected operator "${token.value}"`, token.at);
      }
      return { type: 'Identifier', name: token.value, at: token.at };
    }

    if (token.type === 'punct' && token.value === '(') {
      const expr = this.parseLogicalOr();
      this.expectPunct(')');
      return expr;
    }

    if (token.type === 'punct' && token.value === '[') {
      const elements: Expr[] = [];
      if (!this.checkPunct(']')) {
        do {
          elements.push(this.parseLogicalOr());
        } while (this.matchPunct(','));
      }
      this.expectPunct(']');
      return { type: 'ArrayLiteral', elements, at: token.at };
    }

    throw this.error(`Expected a value but found ${this.describe(token)}`, token.at);
  }

  /** Reads the operator at the cursor, mapping `and`/`or`/`not` to symbols. */
  private peekOperator(): string | undefined {
    const token = this.peek();
    if (token.type === 'punct') return token.value;
    if (token.type === 'identifier') {
      if (token.value === 'in') return 'in';
      return WORD_OPERATORS.get(token.value);
    }
    return undefined;
  }

  private matchOperator(symbol: string): boolean {
    if (this.peekOperator() !== symbol) return false;
    this.advance();
    return true;
  }

  private checkPunct(value: string): boolean {
    const token = this.peek();
    return token.type === 'punct' && token.value === value;
  }

  private matchPunct(value: string): boolean {
    if (!this.checkPunct(value)) return false;
    this.advance();
    return true;
  }

  private expectPunct(value: string): void {
    if (!this.matchPunct(value)) {
      const token = this.peek();
      throw this.error(`Expected "${value}" but found ${this.describe(token)}`, token.at);
    }
  }

  private peek(): Token {
    return this.tokens[this.position] as Token;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.type !== 'eof') this.position += 1;
    return token;
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.position - 1)] as Token;
  }

  private describe(token: Token): string {
    return token.type === 'eof' ? 'end of expression' : JSON.stringify(token.value);
  }

  private error(message: string, at: number): ExpressionError {
    return new ExpressionError(message, at, this.source);
  }
}

/** Parses source text into an expression tree, throwing `ExpressionError`. */
export function parse(source: string): Expr {
  return new Parser(source).parse();
}

/**
 * Collects the root identifiers an expression reads, ignoring function names.
 * Workflow validation uses this to prove a guard only touches variables that
 * earlier nodes are guaranteed to have assigned.
 */
export function collectReferences(expr: Expr, into: Set<string> = new Set()): Set<string> {
  switch (expr.type) {
    case 'Identifier':
      into.add(expr.name);
      break;
    case 'Member':
      collectReferences(expr.object, into);
      break;
    case 'Index':
      collectReferences(expr.object, into);
      collectReferences(expr.index, into);
      break;
    case 'Call':
      for (const arg of expr.args) collectReferences(arg, into);
      break;
    case 'Unary':
      collectReferences(expr.argument, into);
      break;
    case 'Binary':
    case 'Logical':
      collectReferences(expr.left, into);
      collectReferences(expr.right, into);
      break;
    case 'ArrayLiteral':
      for (const element of expr.elements) collectReferences(element, into);
      break;
    case 'Literal':
      break;
  }
  return into;
}
