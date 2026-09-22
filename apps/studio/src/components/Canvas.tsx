import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import { toFlowEdges, toFlowNodes, type PathwayFlowNode } from '../lib/adapters';
import { deriveTrail } from '../lib/trail';
import { NODE_META } from '../lib/nodeMeta';
import { useStudio } from '../state/store';
import { PathwayNode } from '../nodes/PathwayNode';

const nodeTypes: NodeTypes = { pathway: PathwayNode };

export function Canvas() {
  const definition = useStudio((state) => state.definition);
  const validation = useStudio((state) => state.validation);
  const instance = useStudio((state) => state.instance);
  const selectedNodeId = useStudio((state) => state.selectedNodeId);
  const selectNode = useStudio((state) => state.selectNode);
  const moveNodes = useStudio((state) => state.moveNodes);

  const trail = useMemo(() => deriveTrail(definition, instance), [definition, instance]);
  const activeNodeId = instance?.waiting?.nodeId ?? instance?.currentNodeId ?? null;

  /** The definition, plus validation and simulation state, projected onto the graph. */
  const projected = useMemo(
    () =>
      toFlowNodes(definition, {
        activeNodeId,
        visited: trail.visited,
        issues: validation.issues,
      }).map((node) => ({ ...node, selected: node.id === selectedNodeId })),
    [definition, activeNodeId, trail.visited, validation.issues, selectedNodeId],
  );

  const [nodes, setNodes] = useState<PathwayFlowNode[]>(projected);

  /**
   * Re-project on every state change, but carry each node's measured size
   * across. React Flow measures nodes itself and reports the result as a
   * `dimensions` change; replacing the array wholesale would discard that, and
   * anything reading measurements — the minimap especially — would see nodes
   * with no size and render nothing.
   */
  useEffect(() => {
    setNodes((previous) => {
      const byId = new Map(previous.map((node) => [node.id, node]));
      return projected.map((node) => {
        const existing = byId.get(node.id);
        return existing ? { ...existing, ...node } : node;
      });
    });
  }, [projected]);

  const onNodesChange = useCallback(
    (changes: NodeChange<PathwayFlowNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));

      const positions = new Map<string, { x: number; y: number }>();
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          positions.set(change.id, change.position);
        }
      }
      if (positions.size > 0) moveNodes(positions);
    },
    [moveNodes],
  );

  const edges = useMemo(() => toFlowEdges(definition, trail.edges), [definition, trail.edges]);

  return (
    <div className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.15}
        maxZoom={1.6}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeClassName={(node) => `mini mini--${(node.data as { node: { kind: string } }).node.kind}`}
        />
      </ReactFlow>

      <div className="canvas__legend" role="note">
        {Object.entries(NODE_META).map(([kind, meta]) => (
          <span key={kind} className={`legend-chip legend-chip--${kind}`} title={meta.blurb}>
            <span aria-hidden="true">{meta.glyph}</span>
            {meta.label}
          </span>
        ))}
      </div>
    </div>
  );
}
