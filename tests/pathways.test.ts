import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { ClinicalDataStore, REFERENCE_NOW, SYNTHETIC_RECORDS } from '@clinical-flow/fhir-lite';
import { parseWorkflow, validateWorkflow, type WorkflowDefinition } from '@clinical-flow/workflow-core';
import { createClock, WorkflowEngine, type MutableClock, type WorkflowInstance } from '@clinical-flow/workflow-engine';

const NAMES = ['sepsis-screening', 'diabetes-follow-up', 'prior-authorization', 'discharge-planning'] as const;

function load(name: (typeof NAMES)[number]): WorkflowDefinition {
  const url = new URL(`../pathways/${name}.json`, import.meta.url);
  return parseWorkflow(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
}

let clock: MutableClock;
let engineFor: (name: (typeof NAMES)[number]) => WorkflowEngine;

beforeEach(() => {
  clock = createClock(REFERENCE_NOW);
  engineFor = (name) =>
    new WorkflowEngine(load(name), { store: new ClinicalDataStore(SYNTHETIC_RECORDS), clock });
});

/** The node the instance stopped at, whether waiting or finished. */
const restingAt = (instance: WorkflowInstance) =>
  instance.waiting?.nodeId ?? instance.events.at(-1)?.nodeId ?? null;

const branchesTaken = (instance: WorkflowInstance) =>
  instance.events.filter((event) => event.type === 'decision.evaluated').map((event) => event.data?.taken);

describe('every bundled pathway passes the gate CI runs', () => {
  it.each(NAMES)('%s is structurally and semantically valid', (name) => {
    const result = validateWorkflow(load(name));
    expect(result.errors).toEqual([]);
  });
});

describe('sepsis screening', () => {
  it('escalates a patient in septic shock and records the full trail', () => {
    const engine = engineFor('sepsis-screening');
    const waiting = engine.run({ patientId: 'patient-sepsis-positive' });

    expect(branchesTaken(waiting)).toEqual(['septic-shock']);
    expect(waiting.status).toBe('waiting');
    expect(restingAt(waiting)).toBe('physician-review');
    expect(waiting.variables.lactate).toBe(4.2);
    expect(waiting.variables.systolicBp).toBe(88);

    const escalation = waiting.events.find((event) => event.type === 'escalation.raised');
    expect(escalation?.data?.severity).toBe('critical');
    expect(escalation?.data?.toRole).toBe('Rapid Response Team');

    const bundle = waiting.events.find((event) => event.type === 'automation.invoked');
    expect(bundle?.data?.params).toMatchObject({
      bundle: 'hour-1',
      note: 'Marcus Webb met septic shock criteria at lactate 4.2',
    });

    const finished = engine.advance(engine.completeTask(waiting, { documented: true }));
    expect(finished.status).toBe('completed');
    expect(finished.outcome).toBe('escalated');

    expect(
      finished.events.map((event) => `${event.seq}. ${event.type} ${event.nodeId ?? '-'}`),
    ).toMatchSnapshot('septic-shock-audit-trail');
  });

  it('screens a well patient negative without raising anything', () => {
    const instance = engineFor('sepsis-screening').run({ patientId: 'patient-sepsis-negative' });

    expect(branchesTaken(instance)).toEqual(['clear']);
    expect(instance.status).toBe('completed');
    expect(instance.outcome).toBe('completed');
    expect(instance.events.map((event) => event.type)).not.toContain('escalation.raised');
  });

  it('does not start for a paediatric patient, because the trigger filters on age', () => {
    const engine = engineFor('sepsis-screening');
    const store = new ClinicalDataStore([
      {
        ...(SYNTHETIC_RECORDS[0] as (typeof SYNTHETIC_RECORDS)[number]),
        patient: {
          resourceType: 'Patient',
          id: 'patient-child',
          name: 'Child Patient',
          birthDate: '2020-01-01',
          gender: 'other',
          mrn: 'MRN-CHILD',
        },
      },
    ]);
    const childEngine = new WorkflowEngine(load('sepsis-screening'), { store, clock });
    const instance = childEngine.run({ patientId: 'patient-child' });

    expect(instance.outcome).toBe('cancelled');
    expect(instance.events.at(-1)?.message).toMatch(/Trigger filter did not match/);
    expect(engine).toBeDefined();
  });
});

describe('diabetes follow-up', () => {
  it('chases an overdue HbA1c and waits on patient outreach', () => {
    const instance = engineFor('diabetes-follow-up').run({ patientId: 'patient-diabetes-overdue' });

    expect(branchesTaken(instance)).toEqual(['yes', 'overdue']);
    expect(instance.status).toBe('waiting');
    expect(restingAt(instance)).toBe('outreach-call');
    expect(instance.waiting?.assigneeRole).toBe('Care Coordinator');
  });

  it('re-reads the result after the seven day timer and can loop', () => {
    const engine = engineFor('diabetes-follow-up');
    const atOutreach = engine.run({ patientId: 'patient-diabetes-overdue' });

    const atTimer = engine.advance(engine.completeTask(atOutreach, { booked: true }));
    expect(atTimer.waiting?.kind).toBe('timer');

    clock.advance(7 * 24 * 60 * 60_000);
    const secondPass = engine.advance(engine.fireTimer(atTimer));

    // The record still holds the same stale result, so the loop comes back round.
    expect(secondPass.waiting?.nodeId).toBe('outreach-call');
    expect(branchesTaken(secondPass).filter((branch) => branch === 'overdue')).toHaveLength(2);
  });

  it('drops a patient who is not in the diabetes cohort', () => {
    const instance = engineFor('diabetes-follow-up').run({ patientId: 'patient-sepsis-negative' });
    expect(branchesTaken(instance)).toEqual(['no']);
    expect(instance.outcome).toBe('cancelled');
  });
});

describe('prior authorization', () => {
  it('submits, waits on the payer, and books an approved study', () => {
    const engine = engineFor('prior-authorization');
    const atTimer = engine.run({
      patientId: 'patient-priorauth-mri',
      input: { requestedProcedure: 'MRI lumbar spine without contrast' },
    });

    expect(branchesTaken(atTimer)).toEqual(['required']);
    expect(atTimer.waiting?.kind).toBe('timer');

    const submission = atTimer.events.find((event) => event.type === 'automation.invoked');
    expect(submission?.data?.params).toMatchObject({
      procedure: 'MRI lumbar spine without contrast',
      payer: 'Northgate Mutual',
      memberName: 'Tomas Lindqvist',
    });

    clock.advance(48 * 60 * 60_000);
    const atDetermination = engine.advance(engine.fireTimer(atTimer));
    expect(atDetermination.waiting?.nodeId).toBe('record-determination');

    const approved = engine.advance(engine.completeTask(atDetermination, { outcome: 'approved' }));
    expect(approved.status).toBe('completed');
    expect(branchesTaken(approved)).toEqual(['required', 'approved']);
  });

  it('routes a denial to a physician advisor', () => {
    const engine = engineFor('prior-authorization');
    const atTimer = engine.run({
      patientId: 'patient-priorauth-mri',
      input: { requestedProcedure: 'MRI lumbar spine without contrast' },
    });
    clock.advance(48 * 60 * 60_000);
    const atDetermination = engine.advance(engine.fireTimer(atTimer));
    const denied = engine.advance(engine.completeTask(atDetermination, { outcome: 'denied' }));

    expect(denied.waiting?.nodeId).toBe('peer-to-peer');
    const escalation = denied.events.find((event) => event.type === 'escalation.raised');
    expect(escalation?.data?.toRole).toBe('Physician Advisor');
  });

  it('loops back through resubmission when the payer wants more information', () => {
    const engine = engineFor('prior-authorization');
    const atTimer = engine.run({
      patientId: 'patient-priorauth-mri',
      input: { requestedProcedure: 'MRI lumbar spine without contrast' },
    });
    clock.advance(48 * 60 * 60_000);
    const atDetermination = engine.advance(engine.fireTimer(atTimer));
    const needsMore = engine.advance(engine.completeTask(atDetermination, { outcome: 'more-info' }));

    expect(needsMore.waiting?.nodeId).toBe('gather-documentation');

    const resubmitted = engine.advance(engine.completeTask(needsMore, { attached: ['physio notes'] }));
    expect(resubmitted.waiting?.kind).toBe('timer');
    expect(resubmitted.events.filter((event) => event.nodeId === 'submit-request')).not.toHaveLength(0);
  });

  it('skips the whole pathway when the plan does not require authorization', () => {
    const instance = engineFor('prior-authorization').run({
      patientId: 'patient-diabetes-overdue',
      input: { requestedProcedure: 'MRI lumbar spine without contrast' },
    });
    expect(branchesTaken(instance)).toEqual(['not-required']);
    expect(instance.status).toBe('completed');
  });
});

describe('discharge planning', () => {
  it('puts a polypharmacy readmission-risk patient on the full bundle', () => {
    const engine = engineFor('discharge-planning');
    const atPharmacist = engine.run({ patientId: 'patient-discharge-highrisk' });

    expect(branchesTaken(atPharmacist)).toEqual(['high']);
    expect(atPharmacist.variables.medicationCount).toBe(5);
    expect(atPharmacist.variables.admissionCount).toBe(2);
    expect(atPharmacist.waiting?.nodeId).toBe('pharmacist-reconciliation');

    const atReferral = engine.advance(engine.completeTask(atPharmacist, { reconciled: true }));
    expect(atReferral.waiting?.nodeId).toBe('home-health-referral');

    const atTimer = engine.advance(engine.completeTask(atReferral, { accepted: true }));
    expect(atTimer.waiting?.kind).toBe('timer');

    clock.advance(48 * 60 * 60_000);
    const finished = engine.advance(engine.fireTimer(atTimer));
    expect(finished.status).toBe('completed');

    const followUp = finished.events.find(
      (event) => event.type === 'automation.invoked' && event.nodeId === 'schedule-followup-high',
    );
    expect(followUp?.data?.params).toMatchObject({ withinDays: 7, modality: 'in-person' });
  });

  it('gives a short elective stay routine follow-up only', () => {
    const instance = engineFor('discharge-planning').run({ patientId: 'patient-discharge-lowrisk' });

    expect(branchesTaken(instance)).toEqual(['low']);
    expect(instance.status).toBe('completed');
    expect(instance.events.map((event) => event.type)).not.toContain('task.assigned');

    const followUp = instance.events.find((event) => event.type === 'automation.invoked');
    expect(followUp?.data?.params).toMatchObject({ withinDays: 30 });
  });
});
