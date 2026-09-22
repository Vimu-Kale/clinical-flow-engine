import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PathwayFlowNode } from '../lib/adapters';
import { NODE_META, summarise } from '../lib/nodeMeta';

/**
 * One node on the canvas.
 *
 * A decision renders one source handle per branch so an edge physically cannot
 * be attached to a branch that does not exist — the same rule the validator
 * enforces on the definition, expressed as geometry.
 */
export function PathwayNode({ data, selected }: NodeProps<PathwayFlowNode>) {
  const { node, isActive, isVisited, issues } = data;
  const meta = NODE_META[node.kind];
  const hasError = issues.some((issue) => issue.severity === 'error');
  const hasWarning = !hasError && issues.length > 0;

  const classes = [
    'pw-node',
    `pw-node--${node.kind}`,
    selected ? 'is-selected' : '',
    isActive ? 'is-active' : '',
    isVisited && !isActive ? 'is-visited' : '',
    hasError ? 'has-error' : '',
    hasWarning ? 'has-warning' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const branches = node.kind === 'decision' ? node.config.branches : null;

  return (
    <div className={classes}>
      {node.kind !== 'trigger' && <Handle type="target" position={Position.Left} />}

      <div className="pw-node__head">
        <span className="pw-node__glyph" aria-hidden="true">
          {meta.glyph}
        </span>
        <span className="pw-node__kind">{meta.label}</span>
        {hasError && (
          <span className="pw-node__badge pw-node__badge--error" title={issues[0]?.message}>
            !
          </span>
        )}
        {hasWarning && (
          <span className="pw-node__badge pw-node__badge--warning" title={issues[0]?.message}>
            ?
          </span>
        )}
      </div>

      <div className="pw-node__label">{node.label}</div>
      <div className="pw-node__summary">{summarise(node)}</div>

      {branches ? (
        <ul className="pw-node__branches">
          {branches.map((branch) => (
            <li key={branch.id} className="pw-node__branch">
              <span className="pw-node__branch-label">{branch.label}</span>
              {/* Positioned by CSS against the branch row, so rows and handles
                  can never drift apart as labels wrap. */}
              <Handle type="source" position={Position.Right} id={branch.id} />
            </li>
          ))}
        </ul>
      ) : (
        node.kind !== 'terminal' && <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}
