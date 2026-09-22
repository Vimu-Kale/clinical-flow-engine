import { create } from 'zustand';
import { ClinicalDataStore, REFERENCE_NOW, SYNTHETIC_RECORDS, type Patient } from '@clinical-flow/fhir-lite';
import {
  safeParseWorkflow,
  validateWorkflow,
  type ValidationResult,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@clinical-flow/workflow-core';
import {
  createClock,
  WorkflowEngine,
  type MutableClock,
  type WorkflowInstance,
} from '@clinical-flow/workflow-engine';
import { replaceNode } from '../lib/adapters';
import { BUNDLED_PATHWAYS, DEFAULT_PATHWAY } from '../lib/pathways';

const clinicalStore = new ClinicalDataStore(SYNTHETIC_RECORDS);

export const PATIENTS: Patient[] = SYNTHETIC_RECORDS.map((record) => record.patient);

/** Engine and clock are mutable, non-serialisable handles kept outside React state. */
let engine: WorkflowEngine | null = null;
let clock: MutableClock | null = null;

export interface StudioState {
  definition: WorkflowDefinition;
  validation: ValidationResult;
  selectedNodeId: string | null;
  patientId: string;
  /** Declared workflow inputs, captured before a run can start. */
  inputs: Record<string, string>;
  instance: WorkflowInstance | null;
  error: string | null;

  loadBundled: (id: string) => void;
  importDefinition: (raw: unknown) => void;
  selectNode: (id: string | null) => void;
  updateNode: (id: string, update: (node: WorkflowNode) => WorkflowNode) => void;
  moveNodes: (positions: Map<string, { x: number; y: number }>) => void;
  setPatient: (id: string) => void;
  setInput: (key: string, value: string) => void;
  dismissError: () => void;

  startRun: () => void;
  stepRun: () => void;
  runToPause: () => void;
  completeTask: (output: string) => void;
  fireTimer: () => void;
  resetRun: () => void;
}

function blankInputs(definition: WorkflowDefinition): Record<string, string> {
  return Object.fromEntries(definition.inputs.map((name) => [name, '']));
}

/** Any change to the definition invalidates the run that was based on it. */
function withDefinition(definition: WorkflowDefinition) {
  engine = null;
  clock = null;
  return {
    definition,
    validation: validateWorkflow(definition),
    instance: null,
    error: null,
    inputs: blankInputs(definition),
  };
}

export const useStudio = create<StudioState>((set, get) => ({
  definition: DEFAULT_PATHWAY,
  validation: validateWorkflow(DEFAULT_PATHWAY),
  selectedNodeId: null,
  patientId: PATIENTS[0]?.id ?? '',
  inputs: blankInputs(DEFAULT_PATHWAY),
  instance: null,
  error: null,

  loadBundled: (id) => {
    const found = BUNDLED_PATHWAYS.find((pathway) => pathway.id === id);
    if (!found) return;
    set({ ...withDefinition(found), selectedNodeId: null });
  },

  importDefinition: (raw) => {
    const parsed = safeParseWorkflow(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      set({ error: `Import failed: ${first?.path.join('.') || 'root'} — ${first?.message ?? 'invalid'}` });
      return;
    }
    set({ ...withDefinition(parsed.data), selectedNodeId: null });
  },

  selectNode: (id) => set({ selectedNodeId: id }),

  updateNode: (id, update) => {
    // Re-parse after every edit so an inspector field can never push the
    // definition out of schema; a rejected edit is reported, not applied.
    const parsed = safeParseWorkflow(replaceNode(get().definition, id, update));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      set({ error: `${first?.path.join(".") || "value"}: ${first?.message ?? "invalid"}` });
      return;
    }
    set({ ...withDefinition(parsed.data), selectedNodeId: get().selectedNodeId });
  },

  // Dragging only changes layout, so it must not throw away a running simulation.
  moveNodes: (positions) =>
    set((state) => ({
      definition: {
        ...state.definition,
        nodes: state.definition.nodes.map((node) => {
          const next = positions.get(node.id);
          return next ? { ...node, position: next } : node;
        }),
      },
    })),

  setPatient: (id) => set({ patientId: id, instance: null, error: null }),
  setInput: (key, value) => set((state) => ({ inputs: { ...state.inputs, [key]: value }, instance: null })),
  dismissError: () => set({ error: null }),

  startRun: () => {
    const { definition, patientId, inputs, validation } = get();
    if (!validation.valid) {
      set({ error: 'Fix the validation errors before simulating.' });
      return;
    }
    const missing = definition.inputs.filter((name) => (inputs[name] ?? '').trim() === '');
    if (missing.length > 0) {
      set({ error: `Provide a value for: ${missing.join(', ')}` });
      return;
    }

    try {
      clock = createClock(REFERENCE_NOW);
      engine = new WorkflowEngine(definition, { store: clinicalStore, clock });
      const instance = engine.start({ patientId, input: { ...inputs } });
      set({ instance, error: null, selectedNodeId: instance.currentNodeId });
    } catch (error) {
      set({ error: (error as Error).message, instance: null });
    }
  },

  stepRun: () => {
    const { instance } = get();
    if (!engine || !instance) return;
    try {
      const next = engine.step(instance);
      set({ instance: next, selectedNodeId: next.currentNodeId ?? get().selectedNodeId, error: null });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  runToPause: () => {
    const { instance } = get();
    if (!engine || !instance) return;
    try {
      set({ instance: engine.advance(instance), error: null });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  completeTask: (output) => {
    const { instance } = get();
    if (!engine || !instance) return;
    let parsed: unknown = output.trim() === '' ? null : output;
    try {
      parsed = output.trim() === '' ? null : JSON.parse(output);
    } catch {
      // Not JSON: hand the engine the raw string, which is a legitimate task output.
    }
    try {
      set({ instance: engine.advance(engine.completeTask(instance, parsed)), error: null });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  fireTimer: () => {
    const { instance } = get();
    if (!engine || !instance || !clock) return;
    try {
      // Move the simulated clock to the moment the timer was due.
      const dueAt = instance.waiting?.dueAt;
      if (dueAt) clock.set(Date.parse(dueAt));
      set({ instance: engine.advance(engine.fireTimer(instance)), error: null });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  resetRun: () => {
    engine = null;
    clock = null;
    set({ instance: null, error: null });
  },
}));
