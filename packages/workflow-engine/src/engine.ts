import { compile, ExpressionError, type CompiledExpression } from '@clinical-flow/expression';
import { ClinicalDataStore } from '@clinical-flow/fhir-lite';
import {
  validateWorkflow,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@clinical-flow/workflow-core';
import type {
  AutomationHandler,
  Clock,
  EventType,
  WorkflowEvent,
  WorkflowInstance,
} from './types.js';

export interface EngineOptions {
  clock?: Clock;
  store?: ClinicalDataStore;
  /** Side-effect implementations, keyed by an automation node's `action`. */
  automations?: Record<string, AutomationHandler>;
  newInstanceId?: () => string;
  /** Guard against a pathway that somehow never settles. */
  maxSteps?: number;
}

export interface StartOptions {
  patientId: string;
  input?: Record<string, unknown>;
}

/** Thrown when a definition or a caller breaks the engine's contract. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

/** Param values beginning with `=` are expressions evaluated in the instance scope. */
const EXPRESSION_PREFIX = '=';

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Interprets a care pathway one node at a time.
 *
 * Two properties matter more than anything else here. It is **deterministic**:
 * the only non-pure input is the injected clock, so the same definition, the
 * same record and the same clock always produce the same event log. And it is
 * **pausable**: real pathways wait on a lab result, a nurse, or forty-eight
 * hours, so an instance is a plain serialisable value that can be stored,
 * reloaded and resumed rather than a running process.
 */
export class WorkflowEngine {
  private readonly definition: WorkflowDefinition;
  private readonly clock: Clock;
  private readonly store: ClinicalDataStore;
  private readonly automations: Record<string, AutomationHandler>;
  private readonly newInstanceId: () => string;
  private readonly maxSteps: number;
  private readonly nodesById = new Map<string, WorkflowNode>();
  private readonly compiled = new Map<string, CompiledExpression>();

  constructor(definition: WorkflowDefinition, options: EngineOptions = {}) {
    const validation = validateWorkflow(definition);
    if (!validation.valid) {
      const summary = validation.errors.map((issue) => `- ${issue.message}`).join('\n');
      throw new EngineError(`Refusing to run a pathway that failed validation:\n${summary}`);
    }

    this.definition = definition;
    this.clock = options.clock ?? { now: () => Date.now() };
    this.store = options.store ?? new ClinicalDataStore([]);
    this.automations = options.automations ?? {};
    this.maxSteps = options.maxSteps ?? 1000;

    let counter = 0;
    this.newInstanceId = options.newInstanceId ?? (() => `inst-${(counter += 1).toString().padStart(6, '0')}`);

    for (const node of definition.nodes) this.nodesById.set(node.id, node);
  }

  // -- lifecycle ----------------------------------------------------------

  /** Creates an instance positioned at the trigger, without running it. */
  start({ patientId, input = {} }: StartOptions): WorkflowInstance {
    const declared = new Set(this.definition.inputs);
    for (const key of Object.keys(input)) {
      if (!declared.has(key)) {
        throw new EngineError(`"${key}" is not a declared input of ${this.definition.id}.`);
      }
    }
    for (const key of declared) {
      if (!(key in input)) {
        throw new EngineError(`Input "${key}" is required by ${this.definition.id} but was not supplied.`);
      }
    }

    const patient = this.store.query(patientId, { resource: 'Patient' });
    const trigger = this.definition.nodes.find((node) => node.kind === 'trigger');
    if (!trigger) throw new EngineError('Pathway has no trigger node.');

    const now = this.clock.now();
    const instance: WorkflowInstance = {
      id: this.newInstanceId(),
      workflowId: this.definition.id,
      workflowVersion: this.definition.version,
      patientId,
      status: 'running',
      currentNodeId: trigger.id,
      variables: { patient, ...input },
      events: [],
      waiting: null,
      outcome: null,
      startedAt: iso(now),
      updatedAt: iso(now),
    };

    this.emit(instance, 'instance.started', null, `Pathway "${this.definition.name}" started for ${patientId}.`, {
      workflowVersion: this.definition.version,
    });

    return instance;
  }

  /** Runs one node and returns the resulting instance. Never mutates the input. */
  step(instance: WorkflowInstance): WorkflowInstance {
    if (instance.status !== 'running') return instance;

    const draft = this.clone(instance);
    const nodeId = draft.currentNodeId;
    if (!nodeId) {
      return this.fail(draft, null, 'Instance is running but has no current node.');
    }

    const node = this.nodesById.get(nodeId);
    if (!node) {
      return this.fail(draft, nodeId, `Unknown node "${nodeId}".`);
    }

    this.emit(draft, 'node.entered', node.id, `Entered ${node.kind} "${node.label}".`);

    try {
      return this.runNode(draft, node);
    } catch (error) {
      const message = error instanceof ExpressionError ? error.format() : (error as Error).message;
      return this.fail(draft, node.id, message);
    }
  }

  /** Steps repeatedly until the instance is waiting, finished, or fails. */
  advance(instance: WorkflowInstance): WorkflowInstance {
    let current = instance;
    for (let taken = 0; taken < this.maxSteps; taken += 1) {
      if (current.status !== 'running') return current;
      current = this.step(current);
    }
    return this.fail(this.clone(current), current.currentNodeId, `Exceeded ${this.maxSteps} steps without settling.`);
  }

  /** Convenience for `start` followed by `advance`. */
  run(options: StartOptions): WorkflowInstance {
    return this.advance(this.start(options));
  }

  /** Releases a task the instance is waiting on, binding any captured output. */
  completeTask(instance: WorkflowInstance, output?: unknown): WorkflowInstance {
    if (instance.status !== 'waiting' || instance.waiting?.kind !== 'task') {
      throw new EngineError('This instance is not waiting on a task.');
    }

    const draft = this.clone(instance);
    const waiting = draft.waiting as NonNullable<WorkflowInstance['waiting']>;
    const node = this.nodesById.get(waiting.nodeId);
    if (!node || node.kind !== 'task') {
      throw new EngineError(`Waiting node "${waiting.nodeId}" is not a task.`);
    }

    const now = this.clock.now();
    if (waiting.dueAt && now > Date.parse(waiting.dueAt)) {
      const overdueMinutes = Math.round((now - Date.parse(waiting.dueAt)) / 60_000);
      this.emit(draft, 'sla.breached', node.id, `"${node.label}" was completed ${overdueMinutes} minutes past its SLA.`, {
        dueAt: waiting.dueAt,
        overdueMinutes,
      });
    }

    if (node.config.assignTo) {
      draft.variables[node.config.assignTo] = output ?? null;
    }

    this.emit(draft, 'task.completed', node.id, `"${node.label}" completed by ${node.config.assigneeRole}.`, {
      output: output ?? null,
    });

    draft.waiting = null;
    draft.status = 'running';
    return this.moveTo(draft, node.id);
  }

  /** Fires the timer the instance is waiting on and resumes it. */
  fireTimer(instance: WorkflowInstance): WorkflowInstance {
    if (instance.status !== 'waiting' || instance.waiting?.kind !== 'timer') {
      throw new EngineError('This instance is not waiting on a timer.');
    }

    const draft = this.clone(instance);
    const waiting = draft.waiting as NonNullable<WorkflowInstance['waiting']>;
    const node = this.nodesById.get(waiting.nodeId);
    if (!node) throw new EngineError(`Unknown node "${waiting.nodeId}".`);

    this.emit(draft, 'timer.fired', node.id, `Timer "${node.label}" elapsed.`, { dueAt: waiting.dueAt });
    draft.waiting = null;
    draft.status = 'running';
    return this.moveTo(draft, node.id);
  }

  // -- node behaviour -----------------------------------------------------

  private runNode(draft: WorkflowInstance, node: WorkflowNode): WorkflowInstance {
    switch (node.kind) {
      case 'trigger': {
        if (node.config.filter) {
          const matched = this.expression(node.config.filter).evaluateBoolean({
            scope: draft.variables,
            now: this.clock.now(),
          });
          if (!matched) {
            this.emit(draft, 'instance.completed', node.id, 'Trigger filter did not match; pathway did not start.', {
              outcome: 'cancelled',
            });
            draft.status = 'completed';
            draft.outcome = 'cancelled';
            draft.currentNodeId = null;
            return draft;
          }
        }
        return this.moveTo(draft, node.id);
      }

      case 'clinical-data': {
        const value = this.store.query(draft.patientId, {
          resource: node.config.resource,
          ...(node.config.filter ? { filter: node.config.filter } : {}),
          select: node.config.select,
        });
        draft.variables[node.config.assignTo] = value;
        this.emit(draft, 'data.assigned', node.id, `Read ${node.config.resource} into "${node.config.assignTo}".`, {
          variable: node.config.assignTo,
          resource: node.config.resource,
          select: node.config.select,
          value,
        });
        return this.moveTo(draft, node.id);
      }

      case 'decision': {
        const now = this.clock.now();
        const evaluated: Array<{ branchId: string; label: string; result: boolean }> = [];

        for (const branch of node.config.branches) {
          const result = this.expression(branch.when).evaluateBoolean({ scope: draft.variables, now });
          evaluated.push({ branchId: branch.id, label: branch.label, result });
          if (result) {
            this.emit(draft, 'decision.evaluated', node.id, `"${node.label}" took branch "${branch.label}".`, {
              taken: branch.id,
              evaluated,
            });
            return this.moveTo(draft, node.id, branch.id);
          }
        }

        const fallback = node.config.defaultBranchId;
        if (!fallback) {
          throw new Error(`No branch of "${node.label}" matched and it has no default branch.`);
        }
        const label = node.config.branches.find((branch) => branch.id === fallback)?.label ?? fallback;
        this.emit(draft, 'decision.evaluated', node.id, `"${node.label}" fell through to default branch "${label}".`, {
          taken: fallback,
          evaluated,
        });
        return this.moveTo(draft, node.id, fallback);
      }

      case 'task': {
        const now = this.clock.now();
        const dueAt = node.config.slaMinutes ? iso(now + node.config.slaMinutes * 60_000) : null;
        this.emit(draft, 'task.assigned', node.id, `"${node.label}" assigned to ${node.config.assigneeRole}.`, {
          assigneeRole: node.config.assigneeRole,
          instructions: node.config.instructions,
          slaMinutes: node.config.slaMinutes ?? null,
        });
        draft.status = 'waiting';
        draft.waiting = {
          nodeId: node.id,
          kind: 'task',
          since: iso(now),
          dueAt,
          assigneeRole: node.config.assigneeRole,
          instructions: node.config.instructions,
        };
        return draft;
      }

      case 'automation': {
        const now = this.clock.now();
        const params = this.resolveParams(node.config.params, draft.variables, now);
        const handler = Object.prototype.hasOwnProperty.call(this.automations, node.config.action)
          ? this.automations[node.config.action]
          : undefined;
        const result = handler
          ? handler({ node, patientId: draft.patientId, variables: draft.variables, params, now })
          : { action: node.config.action, params, simulated: true };

        if (node.config.assignTo) draft.variables[node.config.assignTo] = result;

        this.emit(draft, 'automation.invoked', node.id, `Ran automation "${node.config.action}".`, {
          action: node.config.action,
          params,
          handled: Boolean(handler),
          result,
        });
        return this.moveTo(draft, node.id);
      }

      case 'timer': {
        const now = this.clock.now();
        const dueAt = iso(now + node.config.durationMinutes * 60_000);
        this.emit(draft, 'timer.started', node.id, `Waiting ${node.config.durationMinutes} minutes at "${node.label}".`, {
          durationMinutes: node.config.durationMinutes,
          dueAt,
        });
        draft.status = 'waiting';
        draft.waiting = { nodeId: node.id, kind: 'timer', since: iso(now), dueAt };
        return draft;
      }

      case 'escalation': {
        this.emit(draft, 'escalation.raised', node.id, `Escalated to ${node.config.toRole}: ${node.config.reason}`, {
          toRole: node.config.toRole,
          severity: node.config.severity,
          reason: node.config.reason,
        });
        return this.moveTo(draft, node.id);
      }

      case 'subworkflow': {
        const now = this.clock.now();
        const input = this.resolveParams(node.config.input, draft.variables, now);
        const result = { workflowId: node.config.workflowId, version: node.config.version ?? null, input, simulated: true };
        if (node.config.assignTo) draft.variables[node.config.assignTo] = result;
        this.emit(draft, 'subworkflow.invoked', node.id, `Invoked sub-pathway "${node.config.workflowId}".`, result);
        return this.moveTo(draft, node.id);
      }

      case 'terminal': {
        const reason = node.config.reason ? ` ${node.config.reason}` : '';
        if (node.config.outcome === 'error') {
          return this.fail(draft, node.id, `Pathway ended in error.${reason}`);
        }
        this.emit(draft, 'instance.completed', node.id, `Pathway ended as "${node.config.outcome}".${reason}`, {
          outcome: node.config.outcome,
        });
        draft.status = 'completed';
        draft.outcome = node.config.outcome;
        draft.currentNodeId = null;
        return draft;
      }
    }
  }

  // -- helpers ------------------------------------------------------------

  private moveTo(draft: WorkflowInstance, fromNodeId: string, branchId?: string): WorkflowInstance {
    const candidates = this.definition.edges.filter(
      (edge) => edge.source === fromNodeId && (branchId === undefined || edge.branchId === branchId),
    );
    const edge = candidates[0];
    if (!edge) {
      const via = branchId ? ` on branch "${branchId}"` : '';
      throw new Error(`No outgoing edge from "${fromNodeId}"${via}.`);
    }
    draft.currentNodeId = edge.target;
    draft.updatedAt = iso(this.clock.now());
    return draft;
  }

  /** Resolves `=expression` values; everything else passes through unchanged. */
  private resolveParams(
    params: Record<string, unknown>,
    scope: Record<string, unknown>,
    now: number,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.startsWith(EXPRESSION_PREFIX)) {
        resolved[key] = this.expression(value.slice(1)).evaluate({ scope, now });
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private expression(source: string): CompiledExpression {
    const cached = this.compiled.get(source);
    if (cached) return cached;
    const compiledExpression = compile(source);
    this.compiled.set(source, compiledExpression);
    return compiledExpression;
  }

  private emit(
    instance: WorkflowInstance,
    type: EventType,
    nodeId: string | null,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const event: WorkflowEvent = {
      seq: instance.events.length + 1,
      at: iso(this.clock.now()),
      type,
      nodeId,
      message,
      ...(data ? { data } : {}),
    };
    instance.events.push(event);
    instance.updatedAt = event.at;
  }

  private fail(draft: WorkflowInstance, nodeId: string | null, message: string): WorkflowInstance {
    this.emit(draft, 'instance.failed', nodeId, message);
    draft.status = 'failed';
    draft.outcome = 'error';
    draft.currentNodeId = null;
    draft.waiting = null;
    return draft;
  }

  private clone(instance: WorkflowInstance): WorkflowInstance {
    return {
      ...instance,
      variables: { ...instance.variables },
      events: [...instance.events],
      waiting: instance.waiting ? { ...instance.waiting } : null,
    };
  }
}
