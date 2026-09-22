import { describe, expect, it, vi } from 'vitest';
import { ClinicalDataStore, REFERENCE_NOW, SYNTHETIC_RECORDS } from '@clinical-flow/fhir-lite';
import { parseWorkflow, type WorkflowDefinition } from '@clinical-flow/workflow-core';
import {
  createClock,
  EngineError,
  WorkflowEngine,
  type AutomationContext,
  type WorkflowInstance,
} from '@clinical-flow/workflow-engine';

const PATIENT = 'patient-sepsis-positive';

const store = () => new ClinicalDataStore(SYNTHETIC_RECORDS);
const clock = () => createClock(REFERENCE_NOW);

function define(nodes: unknown[], edges: unknown[], extra: Record<string, unknown> = {}): WorkflowDefinition {
  return parseWorkflow({ id: 'engine-test', name: 'Engine test', version: '1.0.0', nodes, edges, ...extra });
}

const trigger = (config: Record<string, unknown> = {}) => ({
  id: 'trigger',
  kind: 'trigger',
  label: 'Start',
  config: { event: 'test.event', ...config },
});

const terminal = (id: string, outcome = 'completed') => ({
  id,
  kind: 'terminal',
  label: `End ${id}`,
  config: { outcome },
});

const edge = (id: string, source: string, target: string, branchId?: string) => ({
  id,
  source,
  target,
  ...(branchId ? { branchId } : {}),
});

const types = (instance: WorkflowInstance) => instance.events.map((event) => event.type);

/** trigger -> read lactate -> decision -> terminal (high or low) */
const scoring = define(
  [
    trigger(),
    {
      id: 'read',
      kind: 'clinical-data',
      label: 'Lactate',
      config: { resource: 'Observation', filter: { code: '2524-7' }, select: 'value', assignTo: 'lactate' },
    },
    {
      id: 'check',
      kind: 'decision',
      label: 'Lactate raised?',
      config: {
        branches: [
          { id: 'high', label: 'High', when: 'lactate >= 4' },
          { id: 'low', label: 'Low', when: 'true' },
        ],
        defaultBranchId: 'low',
      },
    },
    terminal('end-high', 'escalated'),
    terminal('end-low'),
  ],
  [
    edge('e1', 'trigger', 'read'),
    edge('e2', 'read', 'check'),
    edge('e3', 'check', 'end-high', 'high'),
    edge('e4', 'check', 'end-low', 'low'),
  ],
);

describe('construction', () => {
  it('refuses a definition that failed validation', () => {
    const broken = define([trigger(), terminal('end')], []);
    expect(() => new WorkflowEngine(broken, { store: store() })).toThrow(EngineError);
    expect(() => new WorkflowEngine(broken, { store: store() })).toThrow(/failed validation/);
  });
});

describe('running a pathway', () => {
  it('walks to a terminal and records every step', () => {
    const engine = new WorkflowEngine(scoring, { store: store(), clock: clock() });
    const instance = engine.run({ patientId: PATIENT });

    expect(instance.status).toBe('completed');
    expect(instance.outcome).toBe('escalated');
    expect(instance.currentNodeId).toBeNull();
    expect(instance.variables.lactate).toBe(4.2);
    expect(types(instance)).toEqual([
      'instance.started',
      'node.entered',
      'node.entered',
      'data.assigned',
      'node.entered',
      'decision.evaluated',
      'node.entered',
      'instance.completed',
    ]);
  });

  it('numbers audit events consecutively from one', () => {
    const engine = new WorkflowEngine(scoring, { store: store(), clock: clock() });
    const instance = engine.run({ patientId: PATIENT });
    expect(instance.events.map((event) => event.seq)).toEqual(instance.events.map((_, index) => index + 1));
  });

  it('takes the fallback branch for a patient who does not match', () => {
    const engine = new WorkflowEngine(scoring, { store: store(), clock: clock() });
    const instance = engine.run({ patientId: 'patient-sepsis-negative' });
    expect(instance.outcome).toBe('completed');
    const decisionEvent = instance.events.find((event) => event.type === 'decision.evaluated');
    expect(decisionEvent?.data?.taken).toBe('low');
  });

  it('produces an identical log when the same inputs are replayed', () => {
    const once = new WorkflowEngine(scoring, { store: store(), clock: clock() }).run({ patientId: PATIENT });
    const twice = new WorkflowEngine(scoring, { store: store(), clock: clock() }).run({ patientId: PATIENT });
    expect(twice.events).toEqual(once.events);
    expect(twice.id).toEqual(once.id);
  });

  it('never mutates the instance it was given', () => {
    const engine = new WorkflowEngine(scoring, { store: store(), clock: clock() });
    const started = engine.start({ patientId: PATIENT });
    const snapshot = structuredClone(started);
    engine.advance(started);
    expect(started).toEqual(snapshot);
  });

  it('stops before the trigger when its filter does not match', () => {
    const filtered = define(
      [trigger({ filter: 'age(patient.birthDate) > 200' }), terminal('end')],
      [edge('e1', 'trigger', 'end')],
    );
    const engine = new WorkflowEngine(filtered, { store: store(), clock: clock() });
    const instance = engine.run({ patientId: PATIENT });
    expect(instance.status).toBe('completed');
    expect(instance.outcome).toBe('cancelled');
    expect(types(instance)).not.toContain('decision.evaluated');
  });
});

describe('declared inputs', () => {
  const withInput = define(
    [trigger(), terminal('end')],
    [edge('e1', 'trigger', 'end')],
    { inputs: ['orderId'] },
  );

  it('binds a declared input into scope', () => {
    const engine = new WorkflowEngine(withInput, { store: store(), clock: clock() });
    const instance = engine.start({ patientId: PATIENT, input: { orderId: 'ord-1' } });
    expect(instance.variables.orderId).toBe('ord-1');
  });

  it('rejects a missing or undeclared input', () => {
    const engine = new WorkflowEngine(withInput, { store: store(), clock: clock() });
    expect(() => engine.start({ patientId: PATIENT })).toThrow(/is required/);
    expect(() => engine.start({ patientId: PATIENT, input: { orderId: 'x', extra: 1 } })).toThrow(
      /not a declared input/,
    );
  });
});

describe('pausing on human work', () => {
  const withTask = define(
    [
      trigger(),
      {
        id: 'review',
        kind: 'task',
        label: 'Review',
        config: { assigneeRole: 'Nurse', instructions: 'Check the patient.', slaMinutes: 30, assignTo: 'review' },
      },
      terminal('end'),
    ],
    [edge('e1', 'trigger', 'review'), edge('e2', 'review', 'end')],
  );

  it('waits at the task and resumes when it is completed', () => {
    const engine = new WorkflowEngine(withTask, { store: store(), clock: clock() });
    const waiting = engine.run({ patientId: PATIENT });

    expect(waiting.status).toBe('waiting');
    expect(waiting.waiting?.kind).toBe('task');
    expect(waiting.waiting?.assigneeRole).toBe('Nurse');
    expect(waiting.waiting?.dueAt).toBe(new Date(REFERENCE_NOW + 30 * 60_000).toISOString());

    const done = engine.advance(engine.completeTask(waiting, { outcome: 'seen' }));
    expect(done.status).toBe('completed');
    expect(done.variables.review).toEqual({ outcome: 'seen' });
    expect(types(done)).toContain('task.completed');
  });

  it('records an SLA breach when the task is finished late', () => {
    const time = clock();
    const engine = new WorkflowEngine(withTask, { store: store(), clock: time });
    const waiting = engine.run({ patientId: PATIENT });

    time.advance(90 * 60_000);
    const done = engine.completeTask(waiting, null);

    const breach = done.events.find((event) => event.type === 'sla.breached');
    expect(breach).toBeDefined();
    expect(breach?.data?.overdueMinutes).toBe(60);
  });

  it('refuses to complete a task when nothing is waiting on one', () => {
    const engine = new WorkflowEngine(scoring, { store: store(), clock: clock() });
    const finished = engine.run({ patientId: PATIENT });
    expect(() => engine.completeTask(finished)).toThrow(/not waiting on a task/);
    expect(() => engine.fireTimer(finished)).toThrow(/not waiting on a timer/);
  });
});

describe('timers', () => {
  const withTimer = define(
    [
      trigger(),
      { id: 'wait', kind: 'timer', label: 'Wait an hour', config: { durationMinutes: 60 } },
      terminal('end'),
    ],
    [edge('e1', 'trigger', 'wait'), edge('e2', 'wait', 'end')],
  );

  it('pauses with a due time and continues once fired', () => {
    const time = clock();
    const engine = new WorkflowEngine(withTimer, { store: store(), clock: time });
    const waiting = engine.run({ patientId: PATIENT });

    expect(waiting.status).toBe('waiting');
    expect(waiting.waiting?.dueAt).toBe(new Date(REFERENCE_NOW + 3_600_000).toISOString());

    time.advance(3_600_000);
    const done = engine.advance(engine.fireTimer(waiting));
    expect(done.status).toBe('completed');
    expect(types(done)).toContain('timer.fired');
  });
});

describe('automations', () => {
  const withAutomation = define(
    [
      trigger(),
      {
        id: 'notify',
        kind: 'automation',
        label: 'Notify',
        config: {
          action: 'notify.team',
          params: { channel: 'ward-7', subject: '=patient.name + " needs review"' },
          assignTo: 'notification',
        },
      },
      terminal('end'),
    ],
    [edge('e1', 'trigger', 'notify'), edge('e2', 'notify', 'end')],
  );

  it('calls a registered handler with resolved parameters', () => {
    const handler = vi.fn((_context: AutomationContext) => ({ delivered: true }));
    const engine = new WorkflowEngine(withAutomation, {
      store: store(),
      clock: clock(),
      automations: { 'notify.team': handler },
    });

    const instance = engine.run({ patientId: PATIENT });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]?.params).toEqual({
      channel: 'ward-7',
      subject: 'Marcus Webb needs review',
    });
    expect(instance.variables.notification).toEqual({ delivered: true });
  });

  it('marks the call as simulated when no handler is registered', () => {
    const engine = new WorkflowEngine(withAutomation, { store: store(), clock: clock() });
    const instance = engine.run({ patientId: PATIENT });
    const event = instance.events.find((item) => item.type === 'automation.invoked');
    expect(event?.data?.handled).toBe(false);
    expect(instance.variables.notification).toMatchObject({ simulated: true });
  });

  it('does not resolve an inherited property as a handler', () => {
    const inherited = define(
      [
        trigger(),
        { id: 'a', kind: 'automation', label: 'A', config: { action: 'constructor', params: {} } },
        terminal('end'),
      ],
      [edge('e1', 'trigger', 'a'), edge('e2', 'a', 'end')],
    );
    const engine = new WorkflowEngine(inherited, { store: store(), clock: clock(), automations: {} });
    const instance = engine.run({ patientId: PATIENT });
    const event = instance.events.find((item) => item.type === 'automation.invoked');
    expect(event?.data?.handled).toBe(false);
    expect(instance.status).toBe('completed');
  });
});

describe('failure handling', () => {
  it('fails the instance when a decision matches nothing and has no default', () => {
    const noMatch = define(
      [
        trigger(),
        {
          id: 'check',
          kind: 'decision',
          label: 'Impossible',
          config: { branches: [{ id: 'never', label: 'Never', when: '1 == 2' }] },
        },
        terminal('end'),
      ],
      [edge('e1', 'trigger', 'check'), edge('e2', 'check', 'end', 'never')],
    );

    const engine = new WorkflowEngine(noMatch, { store: store(), clock: clock() });
    const instance = engine.run({ patientId: PATIENT });

    expect(instance.status).toBe('failed');
    expect(instance.outcome).toBe('error');
    expect(instance.events.at(-1)?.message).toMatch(/no default branch/);
  });

  it('fails cleanly when a guard cannot be evaluated', () => {
    const badGuard = define(
      [
        trigger(),
        {
          id: 'read',
          kind: 'clinical-data',
          label: 'Missing observation',
          config: { resource: 'Observation', filter: { code: 'no-such-code' }, select: 'value', assignTo: 'value' },
        },
        {
          id: 'check',
          kind: 'decision',
          label: 'Compare',
          config: { branches: [{ id: 'high', label: 'High', when: 'value > 1' }] },
        },
        terminal('end'),
      ],
      [edge('e1', 'trigger', 'read'), edge('e2', 'read', 'check'), edge('e3', 'check', 'end', 'high')],
    );

    const engine = new WorkflowEngine(badGuard, { store: store(), clock: clock() });
    const instance = engine.run({ patientId: PATIENT });

    expect(instance.status).toBe('failed');
    expect(instance.events.at(-1)?.type).toBe('instance.failed');
    expect(instance.events.at(-1)?.message).toMatch(/needs a number/);
  });

  it('rejects an unknown patient', () => {
    const engine = new WorkflowEngine(scoring, { store: store(), clock: clock() });
    expect(() => engine.start({ patientId: 'nobody' })).toThrow(/Unknown patient/);
  });

  it('stops a pathway that will not settle within the step budget', () => {
    const chain = [trigger(), terminal('end')] as unknown[];
    const links = ['a', 'b', 'c', 'd', 'e'];
    const chainEdges: unknown[] = [edge('e0', 'trigger', 'a')];
    links.forEach((id, index) => {
      chain.splice(1, 0, { id, kind: 'automation', label: id, config: { action: 'noop', params: {} } });
      const next = links[index + 1] ?? 'end';
      chainEdges.push(edge(`e-${id}`, id, next));
    });

    const engine = new WorkflowEngine(define(chain, chainEdges), {
      store: store(),
      clock: clock(),
      maxSteps: 3,
    });
    const instance = engine.advance(engine.start({ patientId: PATIENT }));

    expect(instance.status).toBe('failed');
    expect(instance.events.at(-1)?.message).toMatch(/Exceeded 3 steps/);
  });
});
