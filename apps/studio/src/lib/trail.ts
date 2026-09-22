import type { WorkflowDefinition } from '@clinical-flow/workflow-core';
import type { WorkflowInstance } from '@clinical-flow/workflow-engine';

export interface Trail {
  visited: Set<string>;
  edges: Set<string>;
}

/**
 * Reconstructs the route an instance took from its audit log alone.
 *
 * Nothing about the path is stored on the instance: the event log is sufficient
 * to redraw it, which is the same property that lets a reviewer replay a run
 * months later from the record rather than from application memory.
 */
export function deriveTrail(definition: WorkflowDefinition, instance: WorkflowInstance | null): Trail {
  const visited = new Set<string>();
  const edges = new Set<string>();
  if (!instance) return { visited, edges };

  let previous: string | null = null;
  let lastBranch: string | null = null;

  for (const event of instance.events) {
    if (event.type === 'decision.evaluated') {
      lastBranch = typeof event.data?.taken === 'string' ? event.data.taken : null;
      continue;
    }
    if (event.type !== 'node.entered' || !event.nodeId) continue;

    const current = event.nodeId;
    visited.add(current);

    if (previous) {
      const edge =
        definition.edges.find(
          (candidate) =>
            candidate.source === previous &&
            candidate.target === current &&
            (lastBranch === null || candidate.branchId === undefined || candidate.branchId === lastBranch),
        ) ?? definition.edges.find((candidate) => candidate.source === previous && candidate.target === current);
      if (edge) edges.add(edge.id);
    }

    previous = current;
    lastBranch = null;
  }

  return { visited, edges };
}
