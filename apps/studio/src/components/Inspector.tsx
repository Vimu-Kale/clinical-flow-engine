import { useMemo } from 'react';
import { compile } from '@clinical-flow/expression';
import { computeAvailableVariables, type WorkflowNode } from '@clinical-flow/workflow-core';
import { Field, NumberInput, Select, TextArea, TextInput } from './fields';
import { NODE_META } from '../lib/nodeMeta';
import { useStudio } from '../state/store';

/** Parses a guard and reports the failure inline, as the author types. */
function GuardStatus({ source }: { source: string }) {
  const problem = useMemo(() => {
    if (source.trim() === '') return 'Empty condition.';
    try {
      compile(source);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }, [source]);

  return problem ? <span className="guard guard--bad">{problem}</span> : <span className="guard guard--ok">parses</span>;
}

export function Inspector() {
  const definition = useStudio((state) => state.definition);
  const selectedNodeId = useStudio((state) => state.selectedNodeId);
  const updateNode = useStudio((state) => state.updateNode);

  const node = definition.nodes.find((candidate) => candidate.id === selectedNodeId);
  const available = useMemo(() => computeAvailableVariables(definition), [definition]);

  if (!node) {
    return (
      <div className="inspector inspector--empty">
        <p className="muted">Select a node on the canvas to inspect and edit it.</p>
      </div>
    );
  }

  const scope = [...(available.get(node.id) ?? new Set<string>())].sort();

  /**
   * Config edits go through the store, which re-parses the whole definition
   * against the schema, so a loose patch here cannot produce an invalid node.
   */
  const patchConfig = (patch: Record<string, unknown>) =>
    updateNode(node.id, (current) => ({ ...current, config: { ...current.config, ...patch } }) as WorkflowNode);

  const patchNode = (patch: Record<string, unknown>) =>
    updateNode(node.id, (current) => ({ ...current, ...patch }) as WorkflowNode);

  return (
    <div className="inspector">
      <header className="inspector__head">
        <span className={`kind-chip kind-chip--${node.kind}`}>
          <span aria-hidden="true">{NODE_META[node.kind].glyph}</span> {NODE_META[node.kind].label}
        </span>
        <code className="inspector__id">{node.id}</code>
      </header>

      <Field label="Label">
        <TextInput value={node.label} onChange={(value) => patchNode({ label: value })} />
      </Field>

      <Field label="Description" hint="Shown to reviewers, not evaluated.">
        <TextArea value={node.description ?? ''} rows={2} onChange={(value) => patchNode({ description: value || undefined })} />
      </Field>

      {node.kind === 'trigger' && (
        <>
          <Field label="Event">
            <TextInput value={node.config.event} onChange={(value) => patchConfig({ event: value })} />
          </Field>
          <Field
            label="Start filter"
            hint={node.config.filter ? <GuardStatus source={node.config.filter} /> : 'Optional. Must be true for the pathway to start.'}
          >
            <TextArea mono value={node.config.filter ?? ''} onChange={(value) => patchConfig({ filter: value || undefined })} />
          </Field>
        </>
      )}

      {node.kind === 'clinical-data' && (
        <>
          <Field label="Resource">
            <Select
              value={node.config.resource}
              options={['Patient', 'Observation', 'Condition', 'MedicationRequest', 'Encounter', 'Coverage']}
              onChange={(value) => patchConfig({ resource: value })}
            />
          </Field>
          <Field label="Filter" hint="JSON object of equality matches, for example {&quot;code&quot;: &quot;2524-7&quot;}.">
            <TextArea
              mono
              rows={3}
              value={JSON.stringify(node.config.filter ?? {}, null, 2)}
              onChange={(value) => {
                try {
                  patchConfig({ filter: JSON.parse(value) });
                } catch {
                  /* keep the last valid value while the author is mid-edit */
                }
              }}
            />
          </Field>
          <Field label="Select">
            <Select
              value={node.config.select}
              options={['all', 'latest', 'value', 'count', 'exists']}
              onChange={(value) => patchConfig({ select: value })}
            />
          </Field>
          <Field label="Assign to" hint="Variable name later guards can read.">
            <TextInput value={node.config.assignTo} onChange={(value) => patchConfig({ assignTo: value })} />
          </Field>
        </>
      )}

      {node.kind === 'decision' && (
        <>
          <p className="muted">Branches are evaluated top to bottom. The first one that is true wins.</p>
          {node.config.branches.map((branch, index) => (
            <div key={branch.id} className="branch-editor">
              <div className="branch-editor__head">
                <span className="branch-editor__order">{index + 1}</span>
                <TextInput
                  value={branch.label}
                  onChange={(value) =>
                    patchConfig({
                      branches: node.config.branches.map((item) =>
                        item.id === branch.id ? { ...item, label: value } : item,
                      ),
                    })
                  }
                />
              </div>
              <TextArea
                mono
                rows={2}
                value={branch.when}
                onChange={(value) =>
                  patchConfig({
                    branches: node.config.branches.map((item) =>
                      item.id === branch.id ? { ...item, when: value } : item,
                    ),
                  })
                }
              />
              <GuardStatus source={branch.when} />
            </div>
          ))}
          <Field label="Default branch" hint="Taken when nothing matches. Without one, an unmatched decision fails the instance.">
            <Select
              value={node.config.defaultBranchId ?? ''}
              options={['', ...node.config.branches.map((branch) => branch.id)]}
              onChange={(value) => patchConfig({ defaultBranchId: value || undefined })}
            />
          </Field>
        </>
      )}

      {node.kind === 'task' && (
        <>
          <Field label="Assignee role">
            <TextInput value={node.config.assigneeRole} onChange={(value) => patchConfig({ assigneeRole: value })} />
          </Field>
          <Field label="Instructions">
            <TextArea rows={3} value={node.config.instructions} onChange={(value) => patchConfig({ instructions: value })} />
          </Field>
          <Field label="SLA (minutes)" hint="Completing past this raises an sla.breached audit event.">
            <NumberInput min={1} value={node.config.slaMinutes} onChange={(value) => patchConfig({ slaMinutes: value })} />
          </Field>
          <Field label="Assign output to">
            <TextInput value={node.config.assignTo ?? ''} onChange={(value) => patchConfig({ assignTo: value || undefined })} />
          </Field>
        </>
      )}

      {node.kind === 'automation' && (
        <>
          <Field label="Action">
            <TextInput value={node.config.action} onChange={(value) => patchConfig({ action: value })} />
          </Field>
          <Field label="Parameters" hint="A string starting with = is evaluated as an expression.">
            <TextArea
              mono
              rows={4}
              value={JSON.stringify(node.config.params, null, 2)}
              onChange={(value) => {
                try {
                  patchConfig({ params: JSON.parse(value) });
                } catch {
                  /* ignore transient invalid JSON */
                }
              }}
            />
          </Field>
          <Field label="Assign result to">
            <TextInput value={node.config.assignTo ?? ''} onChange={(value) => patchConfig({ assignTo: value || undefined })} />
          </Field>
        </>
      )}

      {node.kind === 'timer' && (
        <Field label="Duration (minutes)">
          <NumberInput min={1} value={node.config.durationMinutes} onChange={(value) => patchConfig({ durationMinutes: value ?? 1 })} />
        </Field>
      )}

      {node.kind === 'escalation' && (
        <>
          <Field label="Escalate to">
            <TextInput value={node.config.toRole} onChange={(value) => patchConfig({ toRole: value })} />
          </Field>
          <Field label="Severity">
            <Select
              value={node.config.severity}
              options={['low', 'medium', 'high', 'critical']}
              onChange={(value) => patchConfig({ severity: value })}
            />
          </Field>
          <Field label="Reason">
            <TextArea rows={3} value={node.config.reason} onChange={(value) => patchConfig({ reason: value })} />
          </Field>
        </>
      )}

      {node.kind === 'subworkflow' && (
        <>
          <Field label="Pathway id">
            <TextInput value={node.config.workflowId} onChange={(value) => patchConfig({ workflowId: value })} />
          </Field>
          <Field label="Version">
            <TextInput value={node.config.version ?? ''} onChange={(value) => patchConfig({ version: value || undefined })} />
          </Field>
        </>
      )}

      {node.kind === 'terminal' && (
        <>
          <Field label="Outcome">
            <Select
              value={node.config.outcome}
              options={['completed', 'cancelled', 'escalated', 'error']}
              onChange={(value) => patchConfig({ outcome: value })}
            />
          </Field>
          <Field label="Reason">
            <TextArea rows={2} value={node.config.reason ?? ''} onChange={(value) => patchConfig({ reason: value || undefined })} />
          </Field>
        </>
      )}

      <section className="scope">
        <h3 className="scope__title">Variables available here</h3>
        <p className="muted scope__note">Guaranteed to be set on every path that reaches this node.</p>
        <div className="scope__chips">
          {scope.map((name) => (
            <code key={name} className="chip">
              {name}
            </code>
          ))}
        </div>
      </section>
    </div>
  );
}
