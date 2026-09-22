/** Operators that compare or combine two values. */
export type BinaryOperator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | '+'
  | '-'
  | '*'
  | '/'
  | '%';

export type LogicalOperator = '&&' | '||';

export type UnaryOperator = '-' | '!';

/**
 * The full expression grammar. Deliberately small: there is no assignment, no
 * function definition, no property call and no statement form, so a parsed
 * expression can only ever read from the scope it is given.
 */
export type Expr =
  | { type: 'Literal'; value: string | number | boolean | null }
  | { type: 'Identifier'; name: string; at: number }
  | { type: 'Member'; object: Expr; property: string; at: number }
  | { type: 'Index'; object: Expr; index: Expr; at: number }
  | { type: 'Call'; callee: string; args: Expr[]; at: number }
  | { type: 'Unary'; operator: UnaryOperator; argument: Expr; at: number }
  | { type: 'Binary'; operator: BinaryOperator; left: Expr; right: Expr; at: number }
  | { type: 'Logical'; operator: LogicalOperator; left: Expr; right: Expr; at: number }
  | { type: 'ArrayLiteral'; elements: Expr[]; at: number };

/** Raised for any lex, parse or evaluation failure. Carries a source offset. */
export class ExpressionError extends Error {
  readonly at: number;
  readonly source: string | undefined;

  constructor(message: string, at: number, source?: string) {
    super(message);
    this.name = 'ExpressionError';
    this.at = at;
    this.source = source;
  }

  /** Renders the failure with a caret under the offending character. */
  format(): string {
    if (this.source === undefined) return this.message;
    const caret = ' '.repeat(Math.max(0, this.at)) + '^';
    return `${this.message}\n  ${this.source}\n  ${caret}`;
  }
}
