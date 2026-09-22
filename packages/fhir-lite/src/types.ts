/**
 * A deliberately small subset of FHIR R4. Field names follow the specification
 * so that pathway expressions written here (`patient.birthDate`,
 * `observation.valueQuantity.value`) transfer unchanged to a real FHIR server.
 */

export interface Patient {
  resourceType: 'Patient';
  id: string;
  /** Display name. Synthetic throughout — see `patients.ts`. */
  name: string;
  birthDate: string;
  gender: 'male' | 'female' | 'other' | 'unknown';
  /** Medical record number. */
  mrn: string;
}

export interface Quantity {
  value: number;
  unit: string;
}

export interface Observation {
  resourceType: 'Observation';
  id: string;
  patientId: string;
  /** LOINC code. */
  code: string;
  display: string;
  valueQuantity: Quantity;
  effectiveDateTime: string;
  status: 'registered' | 'preliminary' | 'final' | 'amended';
}

export interface Condition {
  resourceType: 'Condition';
  id: string;
  patientId: string;
  /** ICD-10 code. */
  code: string;
  display: string;
  clinicalStatus: 'active' | 'recurrence' | 'remission' | 'resolved';
  onsetDateTime: string;
}

export interface MedicationRequest {
  resourceType: 'MedicationRequest';
  id: string;
  patientId: string;
  medication: string;
  status: 'active' | 'on-hold' | 'cancelled' | 'completed' | 'stopped';
  authoredOn: string;
}

export interface Encounter {
  resourceType: 'Encounter';
  id: string;
  patientId: string;
  class: 'inpatient' | 'outpatient' | 'emergency' | 'virtual';
  status: 'planned' | 'in-progress' | 'finished' | 'cancelled';
  start: string;
  end: string | null;
  reason: string;
}

export interface Coverage {
  resourceType: 'Coverage';
  id: string;
  patientId: string;
  payer: string;
  plan: string;
  /** Whether the plan requires prior authorisation for advanced imaging. */
  priorAuthRequired: boolean;
}

/** Everything known about one synthetic patient. */
export interface PatientRecord {
  patient: Patient;
  observations: Observation[];
  conditions: Condition[];
  medications: MedicationRequest[];
  encounters: Encounter[];
  coverage: Coverage | null;
}

export type ResourceType =
  | 'Patient'
  | 'Observation'
  | 'Condition'
  | 'MedicationRequest'
  | 'Encounter'
  | 'Coverage';

/** LOINC codes referenced by the bundled pathways. */
export const LOINC = {
  LACTATE: '2524-7',
  BODY_TEMPERATURE: '8310-5',
  HEART_RATE: '8867-4',
  SYSTOLIC_BP: '8480-6',
  RESPIRATORY_RATE: '9279-1',
  WHITE_BLOOD_CELLS: '6690-2',
  HBA1C: '4548-4',
  CREATININE: '2160-0',
  EGFR: '33914-3',
} as const;

/** ICD-10 codes referenced by the bundled pathways. */
export const ICD10 = {
  TYPE_2_DIABETES: 'E11.9',
  HEART_FAILURE: 'I50.9',
  CKD_STAGE_3: 'N18.3',
  COPD: 'J44.9',
  HYPERTENSION: 'I10',
} as const;
