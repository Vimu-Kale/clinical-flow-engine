# Goal: Dynamic Clinical Workflows

**CarePath — config-over-code care pathways**
*Author, version, simulate and execute healthcare workflows as data.*

---

## Objective

Prove that healthcare workflows can be treated as **versioned, testable, executable data** — with a visual authoring layer usable by non-engineers and an execution engine with strong safety guarantees — and ship it as a working open-source reference implementation.

## Problem statement

Clinical workflows are today embedded as imperative code inside EHRs and point solutions. Every protocol change — a new lactate threshold, an added escalation step, a payer rule — becomes an engineering ticket with weeks of lead time and regression risk. The clinicians who own the logic cannot read or review it. There is no safe rehearsal before a change reaches real patients. And audit evidence is reconstructed from application logs after the fact rather than produced as a first-class output.

## Key results

| # | Key result | Target | Status |
|---|---|---|---|
| KR1 | Author + validate + simulate a new pathway end to end, no code | < 30 minutes | ✅ Studio supports library → edit → validate → simulate in one session |
| KR2 | Clinical pathways modelled as working samples | ≥ 4 | ✅ 4 shipped, 65 nodes total, all passing the gate |
| KR3 | Engine determinism — same definition + inputs ⇒ identical trace | 100% | ✅ Enforced by an equality test and a committed snapshot |
| KR4 | Every executed step emits an immutable, replayable audit record | 100% | ✅ 14 event types; the log alone reconstructs the route taken |
| KR5 | Unsafe pathways blocked before they can run | Static gate in CI | ✅ 18 rules incl. dataflow analysis; engine refuses invalid definitions |
| KR6 | Test coverage on the engine and expression evaluator | ≥ 85% | ✅ 96% statements, 94% functions, 85% branches, 98 tests |

## Scope delivered

**Definition layer** — declarative JSON schema with Zod validation, nine node kinds, semantic versioning, declared inputs.

**Static safety gate** — structural rules (entry point, reachability, branch wiring, dead ends) plus semantic rules: every loop must contain a timer, and every variable a guard reads must be assigned on *every* path that reaches it. The latter is a must-analysis over the graph computed to a fixed point, so it stays correct in the presence of loops.

**Execution layer** — deterministic interpreter over the graph, pausable and resumable at task and timer boundaries, with a sandboxed expression evaluator containing no `eval` and no `Function` constructor. Emits an append-only event log that is simultaneously the audit trail and the replay mechanism.

**Authoring layer** — React Flow canvas with typed nodes, property inspector, live guard parsing, validation surfaced on the canvas, and a simulation panel that steps the real engine against synthetic patients.

**Clinical data layer** — FHIR-shaped synthetic records (Patient, Observation, Condition, MedicationRequest, Encounter, Coverage) anchored to a fixed instant so every simulation is reproducible.

## Explicitly out of scope

- Not a medical device; no clinical decision support claims. Synthetic data only, no PHI, no live EHR connection.
- No production auth, multi-tenancy or persistence — this is a reference implementation, not a deployed product.
- Not a general BPMN or Temporal replacement; deliberately domain-shaped for care pathways.

## Why this shape

Three design decisions carry most of the value:

1. **The gate runs before the engine, and the engine enforces it.** `new WorkflowEngine()` throws on a definition with validation errors. There is no path to executing an unsafe pathway, whether it arrives from the studio, an import, or a pull request.

2. **Determinism was designed in, not retrofitted.** The clock is injected everywhere — including into `now()` inside the expression language. That single decision is what makes snapshot testing, reproducible simulation and audit replay all possible at once.

3. **Guards must be genuine booleans.** Coercion is rejected. In a care pathway, quietly treating `count(alerts)` as "true" is precisely the failure mode that must not reach a patient, so it fails loudly at authoring time instead.
