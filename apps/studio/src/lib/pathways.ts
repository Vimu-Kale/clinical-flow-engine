import { parseWorkflow, type WorkflowDefinition } from '@clinical-flow/workflow-core';
import dischargePlanning from '../../../../pathways/discharge-planning.json';
import diabetesFollowUp from '../../../../pathways/diabetes-follow-up.json';
import priorAuthorization from '../../../../pathways/prior-authorization.json';
import sepsisScreening from '../../../../pathways/sepsis-screening.json';

/**
 * The bundled sample pathways, parsed through the same schema the CLI gate and
 * the engine use. If one of these ever drifts out of spec the studio fails loudly
 * at start-up rather than rendering a half-valid graph.
 */
export const BUNDLED_PATHWAYS: WorkflowDefinition[] = [
  sepsisScreening,
  diabetesFollowUp,
  priorAuthorization,
  dischargePlanning,
].map((raw) => parseWorkflow(raw));

export const DEFAULT_PATHWAY = BUNDLED_PATHWAYS[0] as WorkflowDefinition;
