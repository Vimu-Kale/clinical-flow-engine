import { useState } from 'react';
import { PATIENTS, useStudio } from '../state/store';
import { Field, TextArea, TextInput } from './fields';
import { formatMinutes } from '../lib/nodeMeta';

const STATUS_COPY: Record<string, string> = {
  running: 'Running',
  waiting: 'Waiting',
  completed: 'Finished',
  failed: 'Failed',
};

function timeOf(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

export function SimulationPanel() {
  const definition = useStudio((state) => state.definition);
  const validation = useStudio((state) => state.validation);
  const patientId = useStudio((state) => state.patientId);
  const inputs = useStudio((state) => state.inputs);
  const instance = useStudio((state) => state.instance);
  const setPatient = useStudio((state) => state.setPatient);
  const setInput = useStudio((state) => state.setInput);
  const startRun = useStudio((state) => state.startRun);
  const stepRun = useStudio((state) => state.stepRun);
  const runToPause = useStudio((state) => state.runToPause);
  const completeTask = useStudio((state) => state.completeTask);
  const fireTimer = useStudio((state) => state.fireTimer);
  const resetRun = useStudio((state) => state.resetRun);

  const [taskOutput, setTaskOutput] = useState('{ "outcome": "approved" }');

  const patient = PATIENTS.find((candidate) => candidate.id === patientId);
  const waitingOnTask = instance?.status === 'waiting' && instance.waiting?.kind === 'task';
  const waitingOnTimer = instance?.status === 'waiting' && instance.waiting?.kind === 'timer';
  const timerNode = waitingOnTimer
    ? definition.nodes.find((node) => node.id === instance?.waiting?.nodeId)
    : undefined;

  return (
    <div className="simulate">
      <section className="simulate__setup">
        <Field label="Synthetic patient" hint="No real patient data is used anywhere in this project.">
          <select className="input" value={patientId} onChange={(event) => setPatient(event.target.value)}>
            {PATIENTS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} — {candidate.mrn}
              </option>
            ))}
          </select>
        </Field>

        {patient ? (
          <p className="muted simulate__patient">
            Born {patient.birthDate} · {patient.gender}
          </p>
        ) : null}

        {definition.inputs.map((name) => (
          <Field key={name} label={name} hint="Declared workflow input.">
            <TextInput value={inputs[name] ?? ''} onChange={(value) => setInput(name, value)} />
          </Field>
        ))}

        <div className="simulate__controls">
          <button type="button" className="button button--primary" onClick={startRun} disabled={!validation.valid}>
            {instance ? 'Restart' : 'Start'}
          </button>
          <button type="button" className="button" onClick={stepRun} disabled={instance?.status !== 'running'}>
            Step
          </button>
          <button type="button" className="button" onClick={runToPause} disabled={instance?.status !== 'running'}>
            Run
          </button>
          <button type="button" className="button" onClick={resetRun} disabled={!instance}>
            Reset
          </button>
        </div>

        {!validation.valid && <p className="notice notice--bad">Simulation is blocked until validation passes.</p>}
      </section>

      {instance ? (
        <>
          <section className="simulate__status">
            <span className={`pill pill--${instance.status}`}>{STATUS_COPY[instance.status] ?? instance.status}</span>
            {instance.outcome ? <span className="pill">{instance.outcome}</span> : null}
            <code className="muted">{instance.id}</code>
          </section>

          {waitingOnTask ? (
            <section className="simulate__prompt">
              <h3>{instance.waiting?.assigneeRole} must act</h3>
              <p className="muted">{instance.waiting?.instructions}</p>
              <Field label="Task output" hint="JSON is parsed; anything else is passed through as text.">
                <TextArea mono rows={3} value={taskOutput} onChange={setTaskOutput} />
              </Field>
              <button type="button" className="button button--primary" onClick={() => completeTask(taskOutput)}>
                Complete task
              </button>
            </section>
          ) : null}

          {waitingOnTimer ? (
            <section className="simulate__prompt">
              <h3>Waiting on a timer</h3>
              <p className="muted">
                {timerNode?.kind === 'timer'
                  ? `${timerNode.label} — ${formatMinutes(timerNode.config.durationMinutes)}`
                  : 'Timer pending'}
                {instance.waiting?.dueAt ? ` · due ${timeOf(instance.waiting.dueAt)}` : ''}
              </p>
              <button type="button" className="button button--primary" onClick={fireTimer}>
                Advance clock and fire
              </button>
            </section>
          ) : null}

          <section className="simulate__section">
            <h3 className="simulate__heading">Variables</h3>
            <dl className="vars">
              {Object.entries(instance.variables).map(([name, value]) => (
                <div key={name} className="vars__row">
                  <dt>{name}</dt>
                  <dd>
                    <code>{summariseValue(value)}</code>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="simulate__section">
            <h3 className="simulate__heading">
              Audit trail <span className="muted">({instance.events.length} events)</span>
            </h3>
            <ol className="trace">
              {instance.events.map((event) => (
                <li key={event.seq} className={`trace__item trace__item--${event.type.split('.')[0]}`}>
                  <div className="trace__head">
                    <span className="trace__seq">{event.seq}</span>
                    <span className="trace__type">{event.type}</span>
                    <span className="trace__time">{timeOf(event.at)}</span>
                  </div>
                  <p className="trace__message">{event.message}</p>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <p className="muted simulate__idle">
          Pick a patient and press Start. The engine runs one node at a time against the synthetic record, and every
          step it takes is appended to the audit trail below.
        </p>
      )}
    </div>
  );
}

/** Keeps a large FHIR resource readable in the variables list. */
function summariseValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? '' : 's'}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.resourceType === 'string') {
      return `${record.resourceType} ${String(record.display ?? record.name ?? record.id ?? '')}`.trim();
    }
    const json = JSON.stringify(value);
    return json.length > 60 ? `${json.slice(0, 57)}...` : json;
  }
  return String(value);
}
