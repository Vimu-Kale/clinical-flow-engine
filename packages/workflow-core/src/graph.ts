import type { WorkflowDefinition, WorkflowNode } from './schema.js';

/** Adjacency views computed once and shared by every validation rule. */
export interface WorkflowGraph {
  nodesById: Map<string, WorkflowNode>;
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
  trigger: WorkflowNode | undefined;
}

export function buildGraph(definition: WorkflowDefinition): WorkflowGraph {
  const nodesById = new Map<string, WorkflowNode>();
  for (const node of definition.nodes) {
    if (!nodesById.has(node.id)) nodesById.set(node.id, node);
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const id of nodesById.keys()) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }

  for (const edge of definition.edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }

  return {
    nodesById,
    outgoing,
    incoming,
    trigger: definition.nodes.find((node) => node.kind === 'trigger'),
  };
}

/** Node ids reachable from the trigger by following edges forwards. */
export function reachableFrom(graph: WorkflowGraph, startId: string): Set<string> {
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of graph.outgoing.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * Tarjan's strongly connected components, iterative so that a large pathway
 * cannot overflow the stack. Used to find loops that need a timer to be safe.
 */
export function stronglyConnectedComponents(graph: WorkflowGraph): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of graph.nodesById.keys()) {
    if (index.has(root)) continue;

    const work: Array<{ id: string; childIndex: number }> = [{ id: root, childIndex: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1] as { id: string; childIndex: number };
      const { id } = frame;

      if (frame.childIndex === 0) {
        index.set(id, counter);
        lowlink.set(id, counter);
        counter += 1;
        stack.push(id);
        onStack.add(id);
      }

      const children = graph.outgoing.get(id) ?? [];
      if (frame.childIndex < children.length) {
        const child = children[frame.childIndex] as string;
        frame.childIndex += 1;
        if (!index.has(child)) {
          work.push({ id: child, childIndex: 0 });
        } else if (onStack.has(child)) {
          lowlink.set(id, Math.min(lowlink.get(id) ?? 0, index.get(child) ?? 0));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        lowlink.set(parent.id, Math.min(lowlink.get(parent.id) ?? 0, lowlink.get(id) ?? 0));
      }

      if (lowlink.get(id) === index.get(id)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop() as string;
          onStack.delete(member);
          component.push(member);
          if (member === id) break;
        }
        components.push(component);
      }
    }
  }

  return components;
}

/** Variables a node binds when it runs. */
export function assignedVariables(node: WorkflowNode): string[] {
  switch (node.kind) {
    case 'clinical-data':
      return [node.config.assignTo];
    case 'task':
    case 'automation':
    case 'subworkflow':
      return node.config.assignTo ? [node.config.assignTo] : [];
    default:
      return [];
  }
}
