import { describe, expect, it } from 'vitest';
import {
  computeAvailableVariables,
  parseWorkflow,
  safeParseWorkflow,
  validateWorkflow,
  type WorkflowDefinition,
} from '@clinical-flow/workflow-core';

/** Builds a structurally valid definition so tests can target semantic rules. */
function define(nodes: unknown[], edges: unknown[] = [], extra: Record<string, unknown> = {}): WorkflowDefinition {
  return parseWorkflow({ id: 'test', name: 'Test pathway', version: '1.0.0', nodes, edges, ...extra });
}

const trigger = (id = 'trigger', config: Record<string, unknown> = {}) => ({
  id,
  kind: 'trigger',
  label: 'Start',
  config: { event: 'test.event', ...config },
});

const terminal = (id: string) => ({
  id,
  kind: 'terminal',
  label: 'Done',
  config: { outcome: 'completed' },
});

const automation = (id: string, config: Record<string, unknown> = {}) => ({
  id,
  kind: 'automation',
  label: `Automation ${id}`,
  config: { action: 'noop', params: {}, ...config },
});

const readData = (id: string, assignTo: string) => ({
  id,
  kind: 'clinical-data',
  label: `Read ${assignTo}`,
  config: { resource: 'Observation', select: 'value', assignTo },
});

const decision = (id: string, branches: Array<{ id: string; label: string; when: string }>, defaultBranchId?: string) => ({
  id,
  kind: 'decision',
  label: `Decision ${id}`,
  config: { branches, ...(defaultBranchId ? { defaultBranchId } : {}) },
});

const edge = (id: string, source: string, target: string, branchId?: string) => ({
  id,
  source,
  target,
  ...(branchId ? { branchId } : {}),
});

const codes = (definition: WorkflowDefinition) => validateWorkflow(definition).issues.map((issue) => issue.code);

describe('schema parsing', () => {
  it('applies defaults for optional collections', () => {
    const definition = define([trigger(), terminal('end')], [edge('e1', 'trigger', 'end')]);
    expect(definition.inputs).toEqual([]);
    expect(definition.tags).toEqual([]);
    expect(definition.nodes[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('rejects a version that is not semantic', () => {
    const result = safeParseWorkflow({ id: 'x', name: 'x', version: '1.0', nodes: [trigger()] });
    expect(result.success).toBe(false);
  });

  it('rejects a variable name that is not an identifier', () => {
    const result = safeParseWorkflow({
      id: 'x',
      name: 'x',
      version: '1.0.0',
      nodes: [readData('r', '2bad')],
    });
    expect(result.success).toBe(false);
  });
});

describe('structure', () => {
  it('accepts a minimal well-formed pathway', () => {
    const result = validateWorkflow(define([trigger(), terminal('end')], [edge('e1', 'trigger', 'end')]));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('requires exactly one trigger', () => {
    expect(codes(define([terminal('end')]))).toContain('NO_TRIGGER');
    expect(
      codes(
        define(
          [trigger('t1'), trigger('t2'), terminal('end')],
          [edge('e1', 't1', 'end'), edge('e2', 't2', 'end')],
        ),
      ),
    ).toContain('MULTIPLE_TRIGGERS');
  });

  it('requires unique node and edge ids', () => {
    expect(
      codes(define([trigger(), terminal('dup'), terminal('dup')], [edge('e1', 'trigger', 'dup')])),
    ).toContain('DUPLICATE_NODE_ID');
    expect(
      codes(define([trigger(), terminal('end')], [edge('e1', 'trigger', 'end'), edge('e1', 'trigger', 'end')])),
    ).toContain('DUPLICATE_EDGE_ID');
  });

  it('rejects edges that point at nodes which do not exist', () => {
    const issues = codes(define([trigger(), terminal('end')], [edge('e1', 'ghost', 'end'), edge('e2', 'trigger', 'phantom')]));
    expect(issues).toContain('UNKNOWN_EDGE_SOURCE');
    expect(issues).toContain('UNKNOWN_EDGE_TARGET');
  });

  it('keeps the trigger as the only entry point', () => {
    expect(
      codes(
        define(
          [trigger(), automation('a'), terminal('end')],
          [edge('e1', 'trigger', 'a'), edge('e2', 'a', 'trigger'), edge('e3', 'a', 'end')],
        ),
      ),
    ).toContain('TRIGGER_HAS_INCOMING');
  });

  it('rejects a terminal with an outgoing edge', () => {
    expect(
      codes(
        define(
          [trigger(), terminal('end'), automation('a')],
          [edge('e1', 'trigger', 'end'), edge('e2', 'end', 'a')],
        ),
      ),
    ).toContain('TERMINAL_HAS_OUTGOING');
  });

  it('rejects a node that leads nowhere', () => {
    expect(codes(define([trigger(), automation('a'), terminal('end')], [edge('e1', 'trigger', 'a')]))).toContain(
      'DEAD_END',
    );
  });

  it('only lets a decision branch', () => {
    expect(
      codes(
        define(
          [trigger(), automation('a'), terminal('x'), terminal('y')],
          [edge('e1', 'trigger', 'a'), edge('e2', 'a', 'x'), edge('e3', 'a', 'y')],
        ),
      ),
    ).toContain('AMBIGUOUS_ROUTE');
  });

  it('requires at least one reachable terminal', () => {
    expect(codes(define([trigger(), automation('a')], [edge('e1', 'trigger', 'a')]))).toContain('NO_TERMINAL');
  });

  it('warns about a node the trigger cannot reach', () => {
    const issues = validateWorkflow(
      define(
        [trigger(), terminal('end'), automation('orphan'), terminal('other')],
        [edge('e1', 'trigger', 'end'), edge('e2', 'orphan', 'other')],
      ),
    );
    expect(issues.warnings.map((issue) => issue.code)).toContain('UNREACHABLE');
    expect(issues.valid).toBe(true);
  });
});

describe('decision wiring', () => {
  const branches = [
    { id: 'yes', label: 'Yes', when: 'true' },
    { id: 'no', label: 'No', when: 'true' },
  ];

  it('requires every branch to be connected', () => {
    expect(
      codes(
        define(
          [trigger(), decision('d', branches, 'no'), terminal('end')],
          [edge('e1', 'trigger', 'd'), edge('e2', 'd', 'end', 'yes')],
        ),
      ),
    ).toContain('BRANCH_NOT_CONNECTED');
  });

  it('requires an edge leaving a decision to name its branch', () => {
    expect(
      codes(
        define(
          [trigger(), decision('d', branches, 'no'), terminal('end')],
          [edge('e1', 'trigger', 'd'), edge('e2', 'd', 'end')],
        ),
      ),
    ).toContain('EDGE_MISSING_BRANCH');
  });

  it('rejects an edge naming a branch that is not declared', () => {
    expect(
      codes(
        define(
          [trigger(), decision('d', branches, 'no'), terminal('end'), terminal('end2'), terminal('end3')],
          [
            edge('e1', 'trigger', 'd'),
            edge('e2', 'd', 'end', 'yes'),
            edge('e3', 'd', 'end2', 'no'),
            edge('e4', 'd', 'end3', 'maybe'),
          ],
        ),
      ),
    ).toContain('UNKNOWN_BRANCH');
  });

  it('rejects an undeclared default branch', () => {
    expect(
      codes(
        define(
          [trigger(), decision('d', branches, 'nope'), terminal('end'), terminal('end2')],
          [edge('e1', 'trigger', 'd'), edge('e2', 'd', 'end', 'yes'), edge('e3', 'd', 'end2', 'no')],
        ),
      ),
    ).toContain('UNKNOWN_DEFAULT_BRANCH');
  });

  it('warns when a decision has no fallback', () => {
    const result = validateWorkflow(
      define(
        [trigger(), decision('d', branches), terminal('end'), terminal('end2')],
        [edge('e1', 'trigger', 'd'), edge('e2', 'd', 'end', 'yes'), edge('e3', 'd', 'end2', 'no')],
      ),
    );
    expect(result.warnings.map((issue) => issue.code)).toContain('NO_DEFAULT_BRANCH');
    expect(result.valid).toBe(true);
  });
});

describe('loops', () => {
  const loopBranches = [
    { id: 'again', label: 'Again', when: 'true' },
    { id: 'stop', label: 'Stop', when: 'true' },
  ];

  it('rejects a cycle with no timer in it', () => {
    expect(
      codes(
        define(
          [trigger(), automation('a'), decision('d', loopBranches, 'stop'), terminal('end')],
          [
            edge('e1', 'trigger', 'a'),
            edge('e2', 'a', 'd'),
            edge('e3', 'd', 'a', 'again'),
            edge('e4', 'd', 'end', 'stop'),
          ],
        ),
      ),
    ).toContain('UNGUARDED_LOOP');
  });

  it('accepts the same cycle once a timer makes it wait', () => {
    const result = validateWorkflow(
      define(
        [
          trigger(),
          automation('a'),
          decision('d', loopBranches, 'stop'),
          { id: 'wait', kind: 'timer', label: 'Wait', config: { durationMinutes: 60 } },
          terminal('end'),
        ],
        [
          edge('e1', 'trigger', 'a'),
          edge('e2', 'a', 'd'),
          edge('e3', 'd', 'wait', 'again'),
          edge('e4', 'wait', 'a'),
          edge('e5', 'd', 'end', 'stop'),
        ],
      ),
    );
    expect(result.errors).toHaveLength(0);
  });
});

describe('data flow', () => {
  const split = [
    { id: 'left', label: 'Left', when: 'true' },
    { id: 'right', label: 'Right', when: 'true' },
  ];

  /** Diamond where only the chosen branches assign `score`. */
  const diamond = (leftAssigns: boolean, rightAssigns: boolean) =>
    define(
      [
        trigger(),
        decision('split', split, 'right'),
        leftAssigns ? readData('left', 'score') : automation('left'),
        rightAssigns ? readData('right', 'score') : automation('right'),
        decision('check', [{ id: 'high', label: 'High', when: 'score > 10' }], 'high'),
        terminal('end'),
      ],
      [
        edge('e1', 'trigger', 'split'),
        edge('e2', 'split', 'left', 'left'),
        edge('e3', 'split', 'right', 'right'),
        edge('e4', 'left', 'check'),
        edge('e5', 'right', 'check'),
        edge('e6', 'check', 'end', 'high'),
      ],
    );

  it('rejects a guard reading a variable only one branch sets', () => {
    const result = validateWorkflow(diamond(true, false));
    expect(result.errors.map((issue) => issue.code)).toContain('UNKNOWN_VARIABLE');
  });

  it('accepts the guard once every path sets it', () => {
    const result = validateWorkflow(diamond(true, true));
    expect(result.errors).toHaveLength(0);
  });

  it('exposes the variables available at each node', () => {
    const definition = define(
      [trigger(), readData('read', 'lactate'), terminal('end')],
      [edge('e1', 'trigger', 'read'), edge('e2', 'read', 'end')],
      { inputs: ['orderId'] },
    );
    const available = computeAvailableVariables(definition);
    expect([...(available.get('trigger') ?? [])].sort()).toEqual(['orderId', 'patient']);
    expect([...(available.get('read') ?? [])].sort()).toEqual(['orderId', 'patient']);
    expect([...(available.get('end') ?? [])].sort()).toEqual(['lactate', 'orderId', 'patient']);
  });

  it('refuses to let a node overwrite the engine-provided patient', () => {
    expect(
      codes(
        define(
          [trigger(), readData('read', 'patient'), terminal('end')],
          [edge('e1', 'trigger', 'read'), edge('e2', 'read', 'end')],
        ),
      ),
    ).toContain('RESERVED_VARIABLE');
  });
});

describe('expressions inside a pathway', () => {
  const withFilter = (filter: string) =>
    define([trigger('trigger', { filter }), terminal('end')], [edge('e1', 'trigger', 'end')]);

  it('reports a syntax error with its location', () => {
    const result = validateWorkflow(withFilter('1 +'));
    expect(result.errors[0]?.code).toBe('EXPRESSION_SYNTAX');
    expect(result.errors[0]?.field).toBe('config.filter');
  });

  it('reports an unknown function and a bad argument count', () => {
    expect(codes(withFilter('bogus(1) == true'))).toContain('UNKNOWN_FUNCTION');
    expect(codes(withFilter('age() > 1'))).toContain('FUNCTION_ARITY');
  });

  it('checks expressions inside subworkflow inputs', () => {
    const issues = codes(
      define(
        [
          trigger(),
          {
            id: 'sub',
            kind: 'subworkflow',
            label: 'Sub',
            config: { workflowId: 'other', input: { value: 'notDefined + 1' } },
          },
          terminal('end'),
        ],
        [edge('e1', 'trigger', 'sub'), edge('e2', 'sub', 'end')],
      ),
    );
    expect(issues).toContain('UNKNOWN_VARIABLE');
  });
});
