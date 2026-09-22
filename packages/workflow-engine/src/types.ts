import type { WorkflowNode } from '@clinical-flow/workflow-core';

export type InstanceStatus = 'running' | 'waiting' | 'completed' | 'failed';

export type EventType =
  | 'instance.started'
  | 'node.entered'
  | 'data.assigned'
  | 'decision.evaluated'
  | 'task.assigned'
  | 'task.completed'
  | 'sla.breached'
  | 'timer.started'
  | 'timer.fired'
  | 'automation.invoked'
  | 'escalation.raised'
  | 'subworkflow.invoked'
  | 'instance.completed'
  | 'instance.failed';

/**
 * One entry in the append-only audit log.
 *
 * The log is the record of what happened *and* the mechanism for replaying it:
 * because every event carries the clock reading that produced it, a recorded
 * run can be re-derived exactly, which is what makes a pathway auditable rather
 * than merely logged.
 */
export interface WorkflowEvent {
  /** Monotonic within an instance, starting at 1. */
  seq: number;
  at: string;
  type: EventType;
  nodeId: string | null;
  message: string;
  data?: Record<string, unknown>;
}

/** Why an instance is paused, and what would release it. */
export interface WaitingState {
  nodeId: string;
  kind: 'task' | 'timer';
  since: string;
  /** When a timer fires, or when a task breaches its SLA. Null if neither applies. */
  dueAt: string | null;
  assigneeRole?: string;
  instructions?: string;
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  workflowVersion: string;
  patientId: string;
  status: InstanceStatus;
  /** The node about to run, or null once the instance has finished. */
  currentNodeId: string | null;
  variables: Record<string, unknown>;
  events: WorkflowEvent[];
  waiting: WaitingState | null;
  outcome: 'completed' | 'cancelled' | 'escalated' | 'error' | null;
  startedAt: string;
  updatedAt: string;
}

/** Injectable time source. Simulations use a mutable one; production uses the wall clock. */
export interface Clock {
  now(): number;
}

export interface MutableClock extends Clock {
  set(epochMs: number): void;
  advance(ms: number): void;
}

/** Creates a clock the caller controls, so timers can be fired on demand. */
export function createClock(startEpochMs: number): MutableClock {
  let current = startEpochMs;
  return {
    now: () => current,
    set: (epochMs: number) => {
      current = epochMs;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

export interface AutomationContext {
  node: WorkflowNode;
  patientId: string;
  variables: Readonly<Record<string, unknown>>;
  /** Params with every expression already resolved. */
  params: Record<string, unknown>;
  now: number;
}

/** Performs a side effect for an `automation` node and returns its result. */
export type AutomationHandler = (context: AutomationContext) => unknown;
