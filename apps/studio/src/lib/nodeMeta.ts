import type { NodeKind, WorkflowNode } from '@clinical-flow/workflow-core';

export interface NodeMeta {
  label: string;
  glyph: string;
  blurb: string;
}

/** Display metadata for each node kind, used by the palette, canvas and legend. */
export const NODE_META: Record<NodeKind, NodeMeta> = {
  trigger: { label: 'Trigger', glyph: '▶', blurb: 'Where the pathway starts.' },
  'clinical-data': { label: 'Clinical data', glyph: '⛃', blurb: 'Read the record into a variable.' },
  decision: { label: 'Decision', glyph: '◆', blurb: 'Branch on guard expressions, in order.' },
  task: { label: 'Task', glyph: '☑', blurb: 'Human step. Pauses the instance.' },
  automation: { label: 'Automation', glyph: '⚡', blurb: 'Machine step: order, message, write-back.' },
  timer: { label: 'Timer', glyph: '⏱', blurb: 'Wait a fixed duration.' },
  escalation: { label: 'Escalation', glyph: '⚠', blurb: 'Raise to a human with a severity.' },
  subworkflow: { label: 'Sub-pathway', glyph: '⧉', blurb: 'Invoke another published pathway.' },
  terminal: { label: 'Outcome', glyph: '■', blurb: 'End the instance with an outcome.' },
};

/** One-line summary of the interesting part of a node's configuration. */
export function summarise(node: WorkflowNode): string {
  switch (node.kind) {
    case 'trigger':
      return node.config.event;
    case 'clinical-data':
      return `${node.config.resource} → ${node.config.assignTo}`;
    case 'decision':
      return `${node.config.branches.length} branches`;
    case 'task':
      return node.config.assigneeRole;
    case 'automation':
      return node.config.action;
    case 'timer':
      return formatMinutes(node.config.durationMinutes);
    case 'escalation':
      return `${node.config.toRole} · ${node.config.severity}`;
    case 'subworkflow':
      return node.config.workflowId;
    case 'terminal':
      return node.config.outcome;
  }
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  }
  const days = minutes / 1440;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} d`;
}
