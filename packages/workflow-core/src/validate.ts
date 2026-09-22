import { collectReferences, ExpressionError, getFunction, parse, type Expr } from '@clinical-flow/expression';
import type { WorkflowDefinition, WorkflowNode } from './schema.js';
import { assignedVariables, buildGraph, reachableFrom, stronglyConnectedComponents } from './graph.js';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  nodeId?: string;
  edgeId?: string;
  field?: string;
}

export interface ValidationResult {
  /** True when there are no errors. Warnings do not block publishing. */
  valid: boolean;
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** One expression embedded in a definition, with enough context to report on. */
interface ExpressionSite {
  nodeId: string;
  field: string;
  source: string;
}

/** Every expression in the definition, in document order. */
function expressionSites(definition: WorkflowDefinition): ExpressionSite[] {
  const sites: ExpressionSite[] = [];
  for (const node of definition.nodes) {
    if (node.kind === 'trigger' && node.config.filter) {
      sites.push({ nodeId: node.id, field: 'config.filter', source: node.config.filter });
    }
    if (node.kind === 'decision') {
      node.config.branches.forEach((branch, position) => {
        sites.push({ nodeId: node.id, field: `config.branches[${position}].when`, source: branch.when });
      });
    }
    if (node.kind === 'subworkflow') {
      for (const [key, source] of Object.entries(node.config.input)) {
        sites.push({ nodeId: node.id, field: `config.input.${key}`, source });
      }
    }
  }
  return sites;
}

/** Walks an expression tree collecting every function call. */
function collectCalls(expr: Expr, into: Array<{ callee: string; argCount: number }> = []) {
  switch (expr.type) {
    case 'Call':
      into.push({ callee: expr.callee, argCount: expr.args.length });
      for (const arg of expr.args) collectCalls(arg, into);
      break;
    case 'Member':
      collectCalls(expr.object, into);
      break;
    case 'Index':
      collectCalls(expr.object, into);
      collectCalls(expr.index, into);
      break;
    case 'Unary':
      collectCalls(expr.argument, into);
      break;
    case 'Binary':
    case 'Logical':
      collectCalls(expr.left, into);
      collectCalls(expr.right, into);
      break;
    case 'ArrayLiteral':
      for (const element of expr.elements) collectCalls(element, into);
      break;
    case 'Literal':
    case 'Identifier':
      break;
  }
  return into;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/**
 * Computes, for every node, the variables that are guaranteed to be bound by
 * the time that node runs.
 *
 * This is a must-analysis: a variable only counts as available if *every* path
 * into the node assigns it. Optimistic initialisation plus intersection to a
 * fixed point means loops converge correctly instead of assuming a variable
 * exists because one branch happened to set it.
 */
export function computeAvailableVariables(definition: WorkflowDefinition): Map<string, Set<string>> {
  const graph = buildGraph(definition);
  const base = new Set<string>(['patient', ...definition.inputs]);

  const universe = new Set<string>(base);
  for (const node of definition.nodes) {
    for (const name of assignedVariables(node)) universe.add(name);
  }

  const entryId = graph.trigger?.id;
  const reachable = entryId ? reachableFrom(graph, entryId) : new Set<string>();

  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();

  for (const id of graph.nodesById.keys()) {
    const initial = id === entryId ? new Set(base) : new Set(universe);
    incoming.set(id, initial);
    const node = graph.nodesById.get(id) as WorkflowNode;
    outgoing.set(id, new Set([...initial, ...assignedVariables(node)]));
  }

  for (let pass = 0; pass < graph.nodesById.size + 2; pass += 1) {
    let changed = false;

    for (const id of graph.nodesById.keys()) {
      if (id === entryId || !reachable.has(id)) continue;

      const predecessors = (graph.incoming.get(id) ?? []).filter((pred) => reachable.has(pred));
      if (predecessors.length === 0) continue;

      let next: Set<string> | undefined;
      for (const pred of predecessors) {
        const predOut = outgoing.get(pred) as Set<string>;
        next = next === undefined ? new Set(predOut) : new Set([...next].filter((name) => predOut.has(name)));
      }

      const current = incoming.get(id) as Set<string>;
      if (next && !setsEqual(next, current)) {
        incoming.set(id, next);
        const node = graph.nodesById.get(id) as WorkflowNode;
        outgoing.set(id, new Set([...next, ...assignedVariables(node)]));
        changed = true;
      }
    }

    if (!changed) break;
  }

  // Unreachable nodes are reported separately; give them the base scope so they
  // do not produce a second wave of confusing "unknown variable" errors.
  for (const id of graph.nodesById.keys()) {
    if (entryId && !reachable.has(id)) incoming.set(id, new Set(base));
  }

  return incoming;
}

/**
 * Runs every structural and semantic check against a definition.
 *
 * These are the rules that stand between a clinical author and a pathway that
 * cannot safely run: no entry point, a branch with nowhere to go, a guard that
 * reads a variable nothing sets, or a loop with no timer in it.
 */
export function validateWorkflow(definition: WorkflowDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ code, severity: 'error', message, ...extra });
  const warn = (code: string, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ code, severity: 'warning', message, ...extra });

  const graph = buildGraph(definition);

  // --- identity ----------------------------------------------------------
  const nodeIdCounts = new Map<string, number>();
  for (const node of definition.nodes) {
    nodeIdCounts.set(node.id, (nodeIdCounts.get(node.id) ?? 0) + 1);
  }
  for (const [id, count] of nodeIdCounts) {
    if (count > 1) {
      error('DUPLICATE_NODE_ID', `Node id "${id}" is used ${count} times. Ids must be unique.`, { nodeId: id });
    }
  }

  const edgeIdCounts = new Map<string, number>();
  for (const edge of definition.edges) {
    edgeIdCounts.set(edge.id, (edgeIdCounts.get(edge.id) ?? 0) + 1);
  }
  for (const [id, count] of edgeIdCounts) {
    if (count > 1) {
      error('DUPLICATE_EDGE_ID', `Edge id "${id}" is used ${count} times.`, { edgeId: id });
    }
  }

  // --- entry point -------------------------------------------------------
  const triggers = definition.nodes.filter((node) => node.kind === 'trigger');
  if (triggers.length === 0) {
    error('NO_TRIGGER', 'A pathway needs exactly one trigger node to start from.');
  } else if (triggers.length > 1) {
    for (const trigger of triggers.slice(1)) {
      error('MULTIPLE_TRIGGERS', 'A pathway can only have one trigger node.', { nodeId: trigger.id });
    }
  }

  // --- edge endpoints ----------------------------------------------------
  for (const edge of definition.edges) {
    if (!graph.nodesById.has(edge.source)) {
      error('UNKNOWN_EDGE_SOURCE', `Edge "${edge.id}" starts at unknown node "${edge.source}".`, { edgeId: edge.id });
    }
    if (!graph.nodesById.has(edge.target)) {
      error('UNKNOWN_EDGE_TARGET', `Edge "${edge.id}" ends at unknown node "${edge.target}".`, { edgeId: edge.id });
    }
  }

  // --- routing per node kind --------------------------------------------
  for (const node of definition.nodes) {
    const outgoingEdges = definition.edges.filter((edge) => edge.source === node.id);
    const incomingEdges = definition.edges.filter((edge) => edge.target === node.id);

    if (node.kind === 'trigger' && incomingEdges.length > 0) {
      error('TRIGGER_HAS_INCOMING', 'The trigger node cannot have incoming edges.', { nodeId: node.id });
    }

    if (node.kind === 'terminal') {
      if (outgoingEdges.length > 0) {
        error('TERMINAL_HAS_OUTGOING', `Terminal node "${node.label}" cannot have outgoing edges.`, {
          nodeId: node.id,
        });
      }
      continue;
    }

    if (outgoingEdges.length === 0) {
      error('DEAD_END', `Node "${node.label}" has no outgoing edge, so the pathway would stop here without an outcome.`, {
        nodeId: node.id,
      });
      continue;
    }

    if (node.kind === 'decision') {
      const branchIds = new Set(node.config.branches.map((branch) => branch.id));

      for (const branch of node.config.branches) {
        const served = outgoingEdges.some((edge) => edge.branchId === branch.id);
        if (!served) {
          error('BRANCH_NOT_CONNECTED', `Branch "${branch.label}" of "${node.label}" is not connected to anything.`, {
            nodeId: node.id,
            field: `config.branches.${branch.id}`,
          });
        }
      }

      for (const edge of outgoingEdges) {
        if (edge.branchId === undefined) {
          error('EDGE_MISSING_BRANCH', `Edge "${edge.id}" leaves decision "${node.label}" without naming a branch.`, {
            edgeId: edge.id,
            nodeId: node.id,
          });
        } else if (!branchIds.has(edge.branchId)) {
          error('UNKNOWN_BRANCH', `Edge "${edge.id}" refers to branch "${edge.branchId}", which "${node.label}" does not declare.`, {
            edgeId: edge.id,
            nodeId: node.id,
          });
        }
      }

      if (node.config.defaultBranchId && !branchIds.has(node.config.defaultBranchId)) {
        error('UNKNOWN_DEFAULT_BRANCH', `Default branch "${node.config.defaultBranchId}" is not declared on "${node.label}".`, {
          nodeId: node.id,
          field: 'config.defaultBranchId',
        });
      }

      if (!node.config.defaultBranchId) {
        warn('NO_DEFAULT_BRANCH', `"${node.label}" has no default branch. If no guard matches at run time the instance fails.`, {
          nodeId: node.id,
          field: 'config.defaultBranchId',
        });
      }
      continue;
    }

    if (outgoingEdges.length > 1) {
      error('AMBIGUOUS_ROUTE', `Node "${node.label}" has ${outgoingEdges.length} outgoing edges. Only a decision node may branch.`, {
        nodeId: node.id,
      });
    }
  }

  // --- reachability ------------------------------------------------------
  const entry = triggers[0];
  if (entry) {
    const reachable = reachableFrom(graph, entry.id);
    for (const node of definition.nodes) {
      if (!reachable.has(node.id)) {
        warn('UNREACHABLE', `Node "${node.label}" cannot be reached from the trigger.`, { nodeId: node.id });
      }
    }

    const terminals = definition.nodes.filter((node) => node.kind === 'terminal');
    if (terminals.length === 0) {
      error('NO_TERMINAL', 'A pathway needs at least one terminal node so instances can finish.');
    } else if (!terminals.some((node) => reachable.has(node.id))) {
      error('NO_REACHABLE_TERMINAL', 'No terminal node is reachable from the trigger, so instances could never finish.');
    }
  }

  // --- loops must be able to make progress -------------------------------
  for (const component of stronglyConnectedComponents(graph)) {
    const selfLoop =
      component.length === 1 && (graph.outgoing.get(component[0] as string) ?? []).includes(component[0] as string);
    if (component.length < 2 && !selfLoop) continue;

    const hasTimer = component.some((id) => graph.nodesById.get(id)?.kind === 'timer');
    if (!hasTimer) {
      const labels = component
        .map((id) => graph.nodesById.get(id)?.label ?? id)
        .sort()
        .join(' → ');
      error(
        'UNGUARDED_LOOP',
        `This loop has no timer in it, so an instance entering it would spin without waiting: ${labels}.`,
        { nodeId: component[0] as string },
      );
    }
  }

  // --- expressions -------------------------------------------------------
  const available = computeAvailableVariables(definition);

  for (const site of expressionSites(definition)) {
    let ast;
    try {
      ast = parse(site.source);
    } catch (parseError) {
      const detail = parseError instanceof ExpressionError ? parseError.format() : String(parseError);
      error('EXPRESSION_SYNTAX', `Cannot parse expression: ${detail}`, {
        nodeId: site.nodeId,
        field: site.field,
      });
      continue;
    }

    const scope = available.get(site.nodeId) ?? new Set<string>(['patient']);
    for (const reference of collectReferences(ast)) {
      if (!scope.has(reference)) {
        const known = [...scope].sort().join(', ');
        error(
          'UNKNOWN_VARIABLE',
          `Expression reads "${reference}", which is not guaranteed to be set on every path that reaches this node. Available here: ${known || 'nothing'}.`,
          { nodeId: site.nodeId, field: site.field },
        );
      }
    }

    for (const call of collectCalls(ast)) {
      const spec = getFunction(call.callee);
      if (!spec) {
        error('UNKNOWN_FUNCTION', `Unknown function "${call.callee}".`, {
          nodeId: site.nodeId,
          field: site.field,
        });
        continue;
      }
      if (call.argCount < spec.minArgs || call.argCount > spec.maxArgs) {
        error(
          'FUNCTION_ARITY',
          `${spec.signature} was given ${call.argCount} argument${call.argCount === 1 ? '' : 's'}.`,
          { nodeId: site.nodeId, field: site.field },
        );
      }
    }
  }

  // --- variable hygiene --------------------------------------------------
  for (const node of definition.nodes) {
    for (const name of assignedVariables(node)) {
      if (name === 'patient') {
        error('RESERVED_VARIABLE', `"patient" is provided by the engine and cannot be reassigned.`, {
          nodeId: node.id,
          field: 'config.assignTo',
        });
      }
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return { valid: errors.length === 0, issues, errors, warnings };
}
