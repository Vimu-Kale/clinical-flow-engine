# Node reference

Every node has `id`, `kind`, `label`, an optional `description`, a `position`, and a `config` whose shape is determined by `kind`. The Zod schema in `packages/workflow-core/src/schema.ts` is the source of truth.

Variable names (`assignTo`, declared `inputs`) must be plain identifiers: a letter or underscore followed by letters, digits or underscores. `patient` is reserved — the engine provides it and nothing may reassign it.

---

## `trigger`

Where the pathway starts. **Exactly one per pathway**, and it may not have incoming edges.

| Field | Type | Notes |
|---|---|---|
| `event` | string | Domain event that starts the pathway, e.g. `encounter.vitals-recorded` |
| `filter` | expression? | Optional. The pathway only starts when this is true; otherwise the instance ends as `cancelled`. |

```json
{ "event": "encounter.vitals-recorded", "filter": "age(patient.birthDate) >= 18" }
```

## `clinical-data`

Reads the record and binds the result to a variable.

| Field | Type | Notes |
|---|---|---|
| `resource` | enum | `Patient` · `Observation` · `Condition` · `MedicationRequest` · `Encounter` · `Coverage` |
| `filter` | object? | Equality matches on own fields, e.g. `{ "code": "2524-7" }` |
| `select` | enum | `all` (default) · `latest` · `value` · `count` · `exists` |
| `assignTo` | identifier | Variable later guards can read |

`latest` and `value` order by the resource's own date field — `effectiveDateTime` for observations, `onsetDateTime` for conditions, `authoredOn` for medications, `start` for encounters. `value` extracts `valueQuantity.value` from the most recent match.

## `decision`

Branches on guard expressions, evaluated **top to bottom — the first match wins**. Branch order is therefore semantic, which lets a later branch safely assume an earlier one has already excluded the null case.

| Field | Type | Notes |
|---|---|---|
| `branches` | array | Each has `id`, `label` and `when` (an expression that must yield a boolean) |
| `defaultBranchId` | string? | Taken when nothing matches. **Without one, an unmatched decision fails the instance** — the validator warns. |

Each branch must be connected by an edge carrying the matching `branchId`.

## `task`

Human step. **Pauses** the instance until `completeTask()` is called.

| Field | Type | Notes |
|---|---|---|
| `assigneeRole` | string | Who must act |
| `instructions` | string | Shown to the assignee |
| `slaMinutes` | number? | Completing past this appends an `sla.breached` audit event with the overdue minutes |
| `assignTo` | identifier? | Binds the captured output |

## `automation`

Machine step: order a panel, send a message, write back to the record.

| Field | Type | Notes |
|---|---|---|
| `action` | string | Key looked up in the engine's handler registry |
| `params` | object | **A string value starting with `=` is evaluated as an expression** in the instance scope |
| `assignTo` | identifier? | Binds the handler's return value |

With no handler registered, the call is recorded as `{ simulated: true }` and the audit event carries `handled: false` — simulation never produces side effects.

```json
{
  "action": "order.sepsis-bundle",
  "params": { "bundle": "hour-1", "note": "=patient.name + ' met septic shock criteria'" }
}
```

## `timer`

Waits a fixed duration, pausing the instance until `fireTimer()`.

| Field | Type | Notes |
|---|---|---|
| `durationMinutes` | number > 0 | Due time is recorded on the waiting state |

A timer is also what makes a loop legal: **the validator rejects any cycle that does not contain one**, because such a loop could spin without ever waiting.

## `escalation`

Raises the pathway to a human. Does not pause — it records and continues.

| Field | Type | Notes |
|---|---|---|
| `toRole` | string | Who is being escalated to |
| `severity` | enum | `low` · `medium` · `high` · `critical` |
| `reason` | string | Why, recorded in the audit log |

## `subworkflow`

Invokes another published pathway. Currently recorded rather than executed.

| Field | Type | Notes |
|---|---|---|
| `workflowId` | string | Pathway to invoke |
| `version` | string? | Pin to a specific version |
| `input` | object | Maps child input names to expressions evaluated in the parent scope |
| `assignTo` | identifier? | Binds the result |

## `terminal`

Ends the instance. May not have outgoing edges.

| Field | Type | Notes |
|---|---|---|
| `outcome` | enum | `completed` · `cancelled` · `escalated` · `error` |
| `reason` | string? | Recorded on the closing audit event |

`error` fails the instance rather than completing it.

---

## Edges

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within the pathway |
| `source` / `target` | string | Node ids |
| `branchId` | string? | **Required** when the source is a decision; must name a branch that decision declares |
| `label` | string? | Drawn on the canvas |

Only a decision may have more than one outgoing edge. Any other node with two is an `AMBIGUOUS_ROUTE` error.

---

## Audit events

| Event | Emitted when |
|---|---|
| `instance.started` | A run begins |
| `node.entered` | Any node is entered |
| `data.assigned` | A `clinical-data` node binds a variable |
| `decision.evaluated` | A decision picks a branch; carries every guard result |
| `task.assigned` / `task.completed` | A task pauses / is released |
| `sla.breached` | A task is completed past its SLA |
| `timer.started` / `timer.fired` | A timer pauses / elapses |
| `automation.invoked` | An automation runs; carries resolved params and whether a handler existed |
| `escalation.raised` | An escalation node runs |
| `subworkflow.invoked` | A sub-pathway is called |
| `instance.completed` / `instance.failed` | The run ends |
