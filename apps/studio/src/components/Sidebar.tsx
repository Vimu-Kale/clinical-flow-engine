import { useRef } from 'react';
import type { ValidationIssue } from '@clinical-flow/workflow-core';
import { BUNDLED_PATHWAYS } from '../lib/pathways';
import { useStudio } from '../state/store';

function IssueRow({ issue, onSelect }: { issue: ValidationIssue; onSelect: (id: string) => void }) {
  const target = issue.nodeId;
  return (
    <li className={`issue issue--${issue.severity}`}>
      <button type="button" onClick={() => target && onSelect(target)} disabled={!target}>
        <span className="issue__code">{issue.code}</span>
        <span className="issue__message">{issue.message}</span>
      </button>
    </li>
  );
}

export function Sidebar() {
  const definition = useStudio((state) => state.definition);
  const validation = useStudio((state) => state.validation);
  const loadBundled = useStudio((state) => state.loadBundled);
  const importDefinition = useStudio((state) => state.importDefinition);
  const selectNode = useStudio((state) => state.selectNode);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      importDefinition(JSON.parse(await file.text()));
    } catch {
      importDefinition(null);
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(definition, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${definition.id}-v${definition.version}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="sidebar">
      <section className="panel">
        <h2 className="panel__title">Pathway library</h2>
        <ul className="pathway-list">
          {BUNDLED_PATHWAYS.map((pathway) => (
            <li key={pathway.id}>
              <button
                type="button"
                className={pathway.id === definition.id ? 'pathway is-current' : 'pathway'}
                onClick={() => loadBundled(pathway.id)}
              >
                <span className="pathway__name">{pathway.name}</span>
                <span className="pathway__meta">
                  v{pathway.version} · {pathway.specialty ?? 'General'} · {pathway.nodes.length} nodes
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="panel__actions">
          <button type="button" className="button" onClick={() => fileInput.current?.click()}>
            Import JSON
          </button>
          <button type="button" className="button" onClick={handleExport}>
            Export JSON
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            hidden
            onChange={(event) => {
              void handleImport(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      </section>

      <section className="panel panel--grow">
        <h2 className="panel__title">
          Validation
          <span className={validation.valid ? 'pill pill--ok' : 'pill pill--bad'}>
            {validation.valid ? 'passing' : `${validation.errors.length} error${validation.errors.length === 1 ? '' : 's'}`}
          </span>
        </h2>

        {validation.issues.length === 0 ? (
          <p className="muted">
            No structural or semantic problems. Every branch is connected, every guard parses, and every variable a
            guard reads is set on all paths that reach it.
          </p>
        ) : (
          <ul className="issue-list">
            {validation.errors.map((issue, index) => (
              <IssueRow key={`e-${index}`} issue={issue} onSelect={selectNode} />
            ))}
            {validation.warnings.map((issue, index) => (
              <IssueRow key={`w-${index}`} issue={issue} onSelect={selectNode} />
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
