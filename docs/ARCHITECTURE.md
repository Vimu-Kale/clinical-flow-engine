# Architecture

Four packages and one app, with dependencies running strictly one way.

```
                     ┌──────────────────┐
                     │  apps/studio     │  React Flow canvas, inspector,
                     │                  │  simulation harness
                     └────────┬─────────┘
                              │ uses all four
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ workflow-engine │─▶│  workflow-core  │─▶│   expression    │
│  interpreter    │  │  schema + gate  │  │  parse + eval   │
└────────┬────────┘  └─────────────────┘  └─────────────────┘
         │
         ▼
┌─────────────────┐
│   fhir-lite     │  synthetic records + in-memory store
└─────────────────┘
```

`expression` depends on nothing. `workflow-core` depends only on `expression`. The engine composes all three. The studio is a consumer, never a second implementation — the simulation panel drives exactly the engine that would run in production.

---

## Why an expression language at all

A care pathway needs conditions, and the obvious options are all wrong:

- **`eval` / `new Function`** — arbitrary code execution driven by a document a non-engineer edits in a browser.
- **A general scripting runtime** — a sandbox to maintain forever, and still no way to statically answer "which variables does this guard read?"
- **Structured JSON conditions** — safe, but unreadable at clinical complexity. `coalesce(lactate, 0) >= 4 && coalesce(systolicBp, 999) < 90` becomes forty lines of nested objects that no clinician will review.

A purpose-built language is roughly 700 lines and buys three things a general one cannot: it is **statically analysable** (which is how the validator proves a guard only reads variables that are always set), it is **safe by construction** (the grammar has no way to express a method call, so there is nothing to sandbox), and it is **deterministic** (`now()` reads the injected clock, so a guard's result is reproducible).

## Why the gate lives below the engine

`new WorkflowEngine(definition)` throws if `validateWorkflow(definition)` reports errors. Validation is not advice the caller may ignore — it is a precondition of construction. A definition can arrive from the studio, a JSON import or a pull request, and all three paths hit the same check. The CLI gate in CI is the same function; it just reports nicely.

## The dataflow analysis

The rule "every variable a guard reads must be set on every path that reaches it" is a **must-analysis**, computed in `computeAvailableVariables`:

```
universe = { patient } ∪ declared inputs ∪ every assigned variable
IN(trigger) = { patient } ∪ declared inputs
IN(n)       = universe                       // optimistic initialisation
repeat until stable:
    IN(n)  = ⋂ OUT(p) for every reachable predecessor p
    OUT(n) = IN(n) ∪ assigned(n)
```

Optimistic initialisation plus intersection is what makes loops converge to the right answer instead of concluding that a variable exists because one arm of a cycle happened to set it. Unreachable nodes are given the base scope so they produce one clear `UNREACHABLE` warning rather than a cascade of confusing variable errors.

## Why instances are values, not processes

A real pathway waits on a lab result, a nurse, or forty-eight hours. Modelling that as a running process means either holding threads open for days or building a bespoke persistence layer around a runtime you do not control.

Instead an instance is a plain serialisable object. `step()` and `advance()` take one and return a new one; nothing is mutated. Pausing is just a status of `waiting` plus a `waiting` descriptor. Resuming is `completeTask()` or `fireTimer()`. Storing an instance is `JSON.stringify`. This is also what makes the studio's step-through possible at all — React holds instances in state and re-renders them like any other value.

## Determinism, and what it buys

The engine takes a `Clock`. Nothing else in the system reads the wall clock — not the engine, not the expression evaluator's `now()`, not the synthetic data, which is anchored to a fixed `REFERENCE_NOW`.

One decision, three payoffs:

- **Snapshot tests** on the audit trail are stable across machines and across days.
- **Simulation is reproducible** — the same patient and pathway always produce the same trace, so a clinician reviewing a dry-run sees what the author saw.
- **Audit replay** works: given the definition, the record and the recorded clock, a run can be re-derived exactly from the event log rather than trusted from application memory.

## The audit log is the route

Nothing on an instance stores which path it took. `deriveTrail()` in the studio reconstructs the highlighted route on the canvas purely from `instance.events` — the same reconstruction a compliance reviewer would perform months later from the record alone. Keeping the log sufficient for that is the point; if the canvas can redraw the run from it, so can an auditor.

## Testing strategy

| Layer | What is tested |
|---|---|
| `expression` | Grammar and precedence, every library function, and each sandbox guarantee as an explicit regression |
| `workflow-core` | Each validation rule individually, plus the dataflow analysis via a diamond where only one arm assigns |
| `workflow-engine` | Pausing and resuming, SLA breach, failure paths, input contracts, immutability, determinism, step budget |
| Integration | All four bundled pathways driven to completion against synthetic patients on **both** sides of their decisions, with a committed snapshot of the septic-shock trail |

Two real sandbox holes were caught by these tests during development: `'__proto__' in {}` is true, so a prototype key was being accepted as a word operator; and indexing the function table directly resolved `constructor` to `Object.prototype.constructor`, which is callable. Both are now own-property lookups with regression tests, and the same pattern was audited and fixed in the engine's automation-handler registry.
