import { useState } from 'react';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { Sidebar } from './components/Sidebar';
import { SimulationPanel } from './components/SimulationPanel';
import { useStudio } from './state/store';

type Tab = 'inspect' | 'simulate';

export function App() {
  const definition = useStudio((state) => state.definition);
  const error = useStudio((state) => state.error);
  const dismissError = useStudio((state) => state.dismissError);
  const [tab, setTab] = useState<Tab>('simulate');

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark" aria-hidden="true">
            ✚
          </span>
          <div>
            <h1 className="topbar__title">Clinical Flow Engine</h1>
            <p className="topbar__subtitle">Pathway Studio</p>
          </div>
        </div>

        <div className="topbar__pathway">
          <span className="topbar__pathway-name">{definition.name}</span>
          <span className="topbar__pathway-meta">
            v{definition.version}
            {definition.clinicalOwner ? ` · owned by ${definition.clinicalOwner}` : ''}
          </span>
        </div>

        <span className="topbar__badge">Synthetic data only — not for clinical use</span>
      </header>

      {error ? (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
          <button type="button" className="banner__close" onClick={dismissError} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}

      <main className="layout">
        <Sidebar />
        <Canvas />
        <section className="rail">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'inspect'}
              className={tab === 'inspect' ? 'tab is-active' : 'tab'}
              onClick={() => setTab('inspect')}
            >
              Inspect
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'simulate'}
              className={tab === 'simulate' ? 'tab is-active' : 'tab'}
              onClick={() => setTab('simulate')}
            >
              Simulate
            </button>
          </div>
          <div className="rail__body">{tab === 'inspect' ? <Inspector /> : <SimulationPanel />}</div>
        </section>
      </main>
    </div>
  );
}
