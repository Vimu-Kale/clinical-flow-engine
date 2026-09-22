import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { ValidationIssue, WorkflowDefinition, WorkflowNode } from '@clinical-flow/workflow-core';

export interface PathwayNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  /** The node the simulation is about to run, or is paused on. */
  isActive: boolean;
  /** Entered at least once during this simulation. */
  isVisited: boolean;
  issues: ValidationIssue[];
}

export type PathwayFlowNode = Node<PathwayNodeData, 'pathway'>;

/** Projects a definition onto the React Flow graph, folding in live simulation state. */
export function toFlowNodes(
  definition: WorkflowDefinition,
  options: { activeNodeId: string | null; visited: ReadonlySet<string>; issues: ValidationIssue[] },
): PathwayFlowNode[] {
  return definition.nodes.map((node) => ({
    id: node.id,
    type: 'pathway',
    position: node.position,
    data: {
      node,
      isActive: options.activeNodeId === node.id,
      isVisited: options.visited.has(node.id),
      issues: options.issues.filter((issue) => issue.nodeId === node.id),
    },
  }));
}

export function toFlowEdges(definition: WorkflowDefinition, traversed: ReadonlySet<string>): Edge[] {
  return definition.edges.map((edge) => {
    const isTraversed = traversed.has(edge.id);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.branchId ? { sourceHandle: edge.branchId } : {}),
      ...(edge.label ? { label: edge.label } : {}),
      type: 'smoothstep',
      animated: isTraversed,
      className: isTraversed ? 'edge-traversed' : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    };
  });
}

/** Writes dragged positions back into the definition. */
export function applyPositions(
  definition: WorkflowDefinition,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): WorkflowDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      const next = positions.get(node.id);
      return next ? { ...node, position: next } : node;
    }),
  };
}

/** Replaces one node immutably. */
export function replaceNode(
  definition: WorkflowDefinition,
  nodeId: string,
  update: (node: WorkflowNode) => WorkflowNode,
): WorkflowDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => (node.id === nodeId ? update(node) : node)),
  };
}
