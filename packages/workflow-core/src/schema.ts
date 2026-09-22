import { z } from 'zod';

/** Variable names must be plain identifiers so expressions can reference them. */
export const identifier = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a letter or underscore followed by letters, digits or underscores');

const position = z.object({ x: z.number(), y: z.number() });

const baseNode = {
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  position: position.default({ x: 0, y: 0 }),
};

/** Where a pathway begins. Exactly one per workflow. */
export const triggerNodeSchema = z.object({
  ...baseNode,
  kind: z.literal('trigger'),
  config: z.object({
    /** Domain event that starts the pathway, e.g. `encounter.admitted`. */
    event: z.string().min(1),
    /** Optional guard; the pathway only starts when this is true. */
    filter: z.string().optional(),
  }),
});

/** Reads from the clinical record and binds the result to a variable. */
export const clinicalDataNodeSchema = z.object({
  ...baseNode,
  kind: z.literal('clinical-data'),
  config: z.object({
    resource: z.enum(['Patient', 'Observation', 'Condition', 'MedicationRequest', 'Encounter', 'Coverage']),
    filter: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    select: z.enum(['all', 'latest', 'value', 'count', 'exists']).default('all'),
    assignTo: identifier,
  }),
});

/** Branches on guard expressions, in declaration order. */
export const decisionNodeSchema = z.object({
  ...baseNode,
  kind: z.literal('decision'),
  config: z.object({
    branches: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          /** Expression that must evaluate to true or false. */
          when: z.string().min(1),
        }),
      )
      .min(1),
    /** Branch taken when no guard matches. Without one, an unmatched decision fails the instance. */
    defaultBranchId: z.string().optional(),
  }),
});

/** Human-in-the-loop step. Pauses the instance until someone completes it. */
export const taskNodeSchema = z.object({
  ...baseNode,
  kind: z.literal('task'),
  config: z.object({
    assigneeRole: z.string().min(1),
    instructions: z.string().min(1),
    /** Breach of this window raises a timing event in the audit log. */
    slaMinutes: z.number().positive().optional(),
    /** Variable the task's captured output is bound to. */
    assignTo: identifier.optional(),
  }),
});

/** Machine step: order a panel, send a message, write back to the record. */
export const automationNodeSchema = z.object({
  ...baseNode,
  kind: z.literal('automation'),
  config: z.object({
    action: z.string().min(1),
    params: z.record(z.unknown()).default({}),
    assignTo: identifier.optional(),
  }),
});

/** Waits a fixed duration. Also what makes a monitoring loop safe. */
export const timerNodeSchema = z.object({
  ...baseNode,
  kind: z.literal('timer'),
  config: z.object({
    durationMinutes: z.number().positive(),
  }),
});

/** Raises the pathway to a human with a severity and a reason. */
export const escalationNodeSchema = z.object({
  ...baseNode,
  kind: z.literal('escalation'),
  config: z.object({
    toRole: z.string().min(1),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    reason: z.string().min(1),
  }),
});

/** Invokes another published pathway. */
export const subworkflowNodeSchema = z.object({
  ...baseNode,
  kind: z.literal('subworkflow'),
  config: z.object({
    workflowId: z.string().min(1),
    version: z.string().optional(),
    /** Maps child input names to expressions evaluated in the parent scope. */
    input: z.record(z.string()).default({}),
    assignTo: identifier.optional(),
  }),
});

/** Ends the instance with a recorded outcome. */
export const terminalNodeSchema = z.object({
  ...baseNode,
  kind: z.literal('terminal'),
  config: z.object({
    outcome: z.enum(['completed', 'cancelled', 'escalated', 'error']),
    reason: z.string().optional(),
  }),
});

export const workflowNodeSchema = z.discriminatedUnion('kind', [
  triggerNodeSchema,
  clinicalDataNodeSchema,
  decisionNodeSchema,
  taskNodeSchema,
  automationNodeSchema,
  timerNodeSchema,
  escalationNodeSchema,
  subworkflowNodeSchema,
  terminalNodeSchema,
]);

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  /** Required when the source is a decision: names the branch this edge serves. */
  branchId: z.string().optional(),
  label: z.string().optional(),
});

export const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Semantic version. Bump on every published change. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'must be a semantic version such as 1.2.0'),
  description: z.string().optional(),
  specialty: z.string().optional(),
  /** Clinician accountable for the logic, not the engineer who typed it. */
  clinicalOwner: z.string().optional(),
  /** Variables supplied at start, in addition to the always-present `patient`. */
  inputs: z.array(identifier).default([]),
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema).default([]),
  tags: z.array(z.string()).default([]),
});

export type TriggerNode = z.infer<typeof triggerNodeSchema>;
export type ClinicalDataNode = z.infer<typeof clinicalDataNodeSchema>;
export type DecisionNode = z.infer<typeof decisionNodeSchema>;
export type TaskNode = z.infer<typeof taskNodeSchema>;
export type AutomationNode = z.infer<typeof automationNodeSchema>;
export type TimerNode = z.infer<typeof timerNodeSchema>;
export type EscalationNode = z.infer<typeof escalationNodeSchema>;
export type SubworkflowNode = z.infer<typeof subworkflowNodeSchema>;
export type TerminalNode = z.infer<typeof terminalNodeSchema>;

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type NodeKind = WorkflowNode['kind'];

/** Node kinds in palette order. */
export const NODE_KINDS: readonly NodeKind[] = [
  'trigger',
  'clinical-data',
  'decision',
  'task',
  'automation',
  'timer',
  'escalation',
  'subworkflow',
  'terminal',
];

/** Parses unknown JSON into a definition, throwing on structural problems. */
export function parseWorkflow(input: unknown): WorkflowDefinition {
  return workflowDefinitionSchema.parse(input);
}

/** Non-throwing variant, for importing a file a user just dropped in. */
export function safeParseWorkflow(
  input: unknown,
): { success: true; data: WorkflowDefinition } | { success: false; error: z.ZodError } {
  const result = workflowDefinitionSchema.safeParse(input);
  return result.success ? { success: true, data: result.data } : { success: false, error: result.error };
}
