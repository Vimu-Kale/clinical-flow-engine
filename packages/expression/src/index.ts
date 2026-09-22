export { ExpressionError } from './ast.js';
export type { BinaryOperator, Expr, LogicalOperator, UnaryOperator } from './ast.js';
export { tokenize } from './lexer.js';
export type { Token, TokenType } from './lexer.js';
export { collectReferences, parse } from './parser.js';
export { FUNCTIONS, FUNCTION_NAMES, getFunction } from './functions.js';
export type { FunctionContext, FunctionSpec } from './functions.js';
export { compile, evaluate, evaluateBoolean } from './evaluate.js';
export type { CompiledExpression, EvaluateOptions, Scope } from './evaluate.js';
