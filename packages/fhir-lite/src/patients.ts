import type { Condition, Encounter, MedicationRequest, Observation, PatientRecord } from './types.js';
import { ICD10, LOINC } from './types.js';

/**
 * All bundled data is anchored to a fixed instant rather than `Date.now()`, so
 * simulations and snapshot tests produce identical results on every machine and
 * on every day. Pass this as the engine clock when replaying the samples.
 */
export const REFERENCE_NOW = Date.parse('2026-03-15T09:00:00.000Z');

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const hoursAgo = (hours: number): string => new Date(REFERENCE_NOW - hours * HOUR_MS).toISOString();
const daysAgo = (days: number): string => new Date(REFERENCE_NOW - days * DAY_MS).toISOString();

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${(sequence += 1).toString().padStart(4, '0')}`;

function observation(
  patientId: string,
  code: string,
  display: string,
  value: number,
  unit: string,
  effectiveDateTime: string,
): Observation {
  return {
    resourceType: 'Observation',
    id: nextId('obs'),
    patientId,
    code,
    display,
    valueQuantity: { value, unit },
    effectiveDateTime,
    status: 'final',
  };
}

function condition(
  patientId: string,
  code: string,
  display: string,
  onsetDateTime: string,
): Condition {
  return {
    resourceType: 'Condition',
    id: nextId('cond'),
    patientId,
    code,
    display,
    clinicalStatus: 'active',
    onsetDateTime,
  };
}

function medication(
  patientId: string,
  name: string,
  authoredOn: string,
): MedicationRequest {
  return {
    resourceType: 'MedicationRequest',
    id: nextId('med'),
    patientId,
    medication: name,
    status: 'active',
    authoredOn,
  };
}

function encounter(
  patientId: string,
  encounterClass: Encounter['class'],
  status: Encounter['status'],
  start: string,
  end: string | null,
  reason: string,
): Encounter {
  return {
    resourceType: 'Encounter',
    id: nextId('enc'),
    patientId,
    class: encounterClass,
    status,
    start,
    end,
    reason,
  };
}

/** Meets every sepsis screening criterion — the positive path. */
const sepsisPositive: PatientRecord = {
  patient: {
    resourceType: 'Patient',
    id: 'patient-sepsis-positive',
    name: 'Marcus Webb',
    birthDate: '1957-11-02',
    gender: 'male',
    mrn: 'MRN-100241',
  },
  observations: [
    observation('patient-sepsis-positive', LOINC.LACTATE, 'Lactate', 4.2, 'mmol/L', hoursAgo(1)),
    observation('patient-sepsis-positive', LOINC.BODY_TEMPERATURE, 'Body temperature', 38.9, 'Cel', hoursAgo(2)),
    observation('patient-sepsis-positive', LOINC.HEART_RATE, 'Heart rate', 118, '/min', hoursAgo(1)),
    observation('patient-sepsis-positive', LOINC.SYSTOLIC_BP, 'Systolic blood pressure', 88, 'mm[Hg]', hoursAgo(1)),
    observation('patient-sepsis-positive', LOINC.RESPIRATORY_RATE, 'Respiratory rate', 24, '/min', hoursAgo(1)),
    observation('patient-sepsis-positive', LOINC.WHITE_BLOOD_CELLS, 'White blood cell count', 17.4, '10*3/uL', hoursAgo(3)),
  ],
  conditions: [
    condition('patient-sepsis-positive', ICD10.COPD, 'Chronic obstructive pulmonary disease', daysAgo(1460)),
    condition('patient-sepsis-positive', ICD10.HYPERTENSION, 'Essential hypertension', daysAgo(2200)),
  ],
  medications: [medication('patient-sepsis-positive', 'Tiotropium 18 mcg inhalation', daysAgo(90))],
  encounters: [
    encounter('patient-sepsis-positive', 'emergency', 'in-progress', hoursAgo(4), null, 'Fever and confusion'),
  ],
  coverage: null,
};

/** Normal vitals — the negative path, proving the screen does not over-trigger. */
const sepsisNegative: PatientRecord = {
  patient: {
    resourceType: 'Patient',
    id: 'patient-sepsis-negative',
    name: 'Dana Ruiz',
    birthDate: '1984-06-19',
    gender: 'female',
    mrn: 'MRN-100388',
  },
  observations: [
    observation('patient-sepsis-negative', LOINC.LACTATE, 'Lactate', 1.1, 'mmol/L', hoursAgo(1)),
    observation('patient-sepsis-negative', LOINC.BODY_TEMPERATURE, 'Body temperature', 37.1, 'Cel', hoursAgo(2)),
    observation('patient-sepsis-negative', LOINC.HEART_RATE, 'Heart rate', 78, '/min', hoursAgo(1)),
    observation('patient-sepsis-negative', LOINC.SYSTOLIC_BP, 'Systolic blood pressure', 122, 'mm[Hg]', hoursAgo(1)),
    observation('patient-sepsis-negative', LOINC.RESPIRATORY_RATE, 'Respiratory rate', 16, '/min', hoursAgo(1)),
    observation('patient-sepsis-negative', LOINC.WHITE_BLOOD_CELLS, 'White blood cell count', 8.2, '10*3/uL', hoursAgo(3)),
  ],
  conditions: [],
  medications: [],
  encounters: [
    encounter('patient-sepsis-negative', 'emergency', 'in-progress', hoursAgo(2), null, 'Ankle injury'),
  ],
  coverage: null,
};

/** Diabetic with an overdue and uncontrolled HbA1c. */
const diabetesOverdue: PatientRecord = {
  patient: {
    resourceType: 'Patient',
    id: 'patient-diabetes-overdue',
    name: 'Alice Njoroge',
    birthDate: '1968-02-27',
    gender: 'female',
    mrn: 'MRN-100512',
  },
  observations: [
    observation('patient-diabetes-overdue', LOINC.HBA1C, 'Hemoglobin A1c', 9.4, '%', daysAgo(214)),
    observation('patient-diabetes-overdue', LOINC.HBA1C, 'Hemoglobin A1c', 8.1, '%', daysAgo(398)),
    observation('patient-diabetes-overdue', LOINC.CREATININE, 'Creatinine', 1.3, 'mg/dL', daysAgo(214)),
    observation('patient-diabetes-overdue', LOINC.EGFR, 'Estimated GFR', 58, 'mL/min/1.73m2', daysAgo(214)),
  ],
  conditions: [
    condition('patient-diabetes-overdue', ICD10.TYPE_2_DIABETES, 'Type 2 diabetes mellitus', daysAgo(2900)),
    condition('patient-diabetes-overdue', ICD10.CKD_STAGE_3, 'Chronic kidney disease stage 3', daysAgo(500)),
  ],
  medications: [
    medication('patient-diabetes-overdue', 'Metformin 1000 mg twice daily', daysAgo(214)),
    medication('patient-diabetes-overdue', 'Lisinopril 10 mg daily', daysAgo(400)),
  ],
  encounters: [
    encounter('patient-diabetes-overdue', 'outpatient', 'finished', daysAgo(214), daysAgo(214), 'Diabetes review'),
  ],
  coverage: {
    resourceType: 'Coverage',
    id: 'cov-0001',
    patientId: 'patient-diabetes-overdue',
    payer: 'Meridian Health Plan',
    plan: 'Choice PPO',
    priorAuthRequired: false,
  },
};

/** Advanced imaging request against a plan that requires prior authorisation. */
const priorAuthImaging: PatientRecord = {
  patient: {
    resourceType: 'Patient',
    id: 'patient-priorauth-mri',
    name: 'Tomas Lindqvist',
    birthDate: '1980-09-14',
    gender: 'male',
    mrn: 'MRN-100677',
  },
  observations: [],
  conditions: [
    condition('patient-priorauth-mri', 'M54.50', 'Low back pain, unspecified', daysAgo(75)),
  ],
  medications: [
    medication('patient-priorauth-mri', 'Naproxen 500 mg twice daily', daysAgo(60)),
  ],
  encounters: [
    encounter('patient-priorauth-mri', 'outpatient', 'finished', daysAgo(3), daysAgo(3), 'Persistent low back pain'),
  ],
  coverage: {
    resourceType: 'Coverage',
    id: 'cov-0002',
    patientId: 'patient-priorauth-mri',
    payer: 'Northgate Mutual',
    plan: 'Essential HMO',
    priorAuthRequired: true,
  },
};

/** Long inpatient stay with heart failure and CKD — high readmission risk. */
const dischargeHighRisk: PatientRecord = {
  patient: {
    resourceType: 'Patient',
    id: 'patient-discharge-highrisk',
    name: 'Eleanor Pike',
    birthDate: '1946-04-08',
    gender: 'female',
    mrn: 'MRN-100845',
  },
  observations: [
    observation('patient-discharge-highrisk', LOINC.CREATININE, 'Creatinine', 1.9, 'mg/dL', hoursAgo(12)),
    observation('patient-discharge-highrisk', LOINC.EGFR, 'Estimated GFR', 34, 'mL/min/1.73m2', hoursAgo(12)),
    observation('patient-discharge-highrisk', LOINC.SYSTOLIC_BP, 'Systolic blood pressure', 104, 'mm[Hg]', hoursAgo(6)),
  ],
  conditions: [
    condition('patient-discharge-highrisk', ICD10.HEART_FAILURE, 'Congestive heart failure', daysAgo(1100)),
    condition('patient-discharge-highrisk', ICD10.CKD_STAGE_3, 'Chronic kidney disease stage 3', daysAgo(800)),
    condition('patient-discharge-highrisk', ICD10.HYPERTENSION, 'Essential hypertension', daysAgo(3000)),
  ],
  medications: [
    medication('patient-discharge-highrisk', 'Furosemide 40 mg daily', daysAgo(6)),
    medication('patient-discharge-highrisk', 'Carvedilol 6.25 mg twice daily', daysAgo(6)),
    medication('patient-discharge-highrisk', 'Spironolactone 25 mg daily', daysAgo(6)),
    medication('patient-discharge-highrisk', 'Atorvastatin 40 mg daily', daysAgo(700)),
    medication('patient-discharge-highrisk', 'Apixaban 5 mg twice daily', daysAgo(700)),
  ],
  encounters: [
    encounter('patient-discharge-highrisk', 'inpatient', 'in-progress', daysAgo(6), null, 'Acute heart failure exacerbation'),
    encounter('patient-discharge-highrisk', 'inpatient', 'finished', daysAgo(48), daysAgo(44), 'Heart failure exacerbation'),
  ],
  coverage: {
    resourceType: 'Coverage',
    id: 'cov-0003',
    patientId: 'patient-discharge-highrisk',
    payer: 'Statewide Senior Care',
    plan: 'Advantage Complete',
    priorAuthRequired: true,
  },
};

/** Short elective stay, few medications — the low-risk discharge path. */
const dischargeLowRisk: PatientRecord = {
  patient: {
    resourceType: 'Patient',
    id: 'patient-discharge-lowrisk',
    name: 'Jordan Alves',
    birthDate: '1991-12-30',
    gender: 'male',
    mrn: 'MRN-100901',
  },
  observations: [
    observation('patient-discharge-lowrisk', LOINC.CREATININE, 'Creatinine', 0.9, 'mg/dL', hoursAgo(20)),
    observation('patient-discharge-lowrisk', LOINC.BODY_TEMPERATURE, 'Body temperature', 36.8, 'Cel', hoursAgo(4)),
  ],
  conditions: [],
  medications: [medication('patient-discharge-lowrisk', 'Paracetamol 1 g as needed', daysAgo(1))],
  encounters: [
    encounter('patient-discharge-lowrisk', 'inpatient', 'in-progress', daysAgo(1), null, 'Elective appendectomy'),
  ],
  coverage: {
    resourceType: 'Coverage',
    id: 'cov-0004',
    patientId: 'patient-discharge-lowrisk',
    payer: 'Meridian Health Plan',
    plan: 'Choice PPO',
    priorAuthRequired: false,
  },
};

/** Every bundled synthetic record. No real patient data appears here. */
export const SYNTHETIC_RECORDS: readonly PatientRecord[] = [
  sepsisPositive,
  sepsisNegative,
  diabetesOverdue,
  priorAuthImaging,
  dischargeHighRisk,
  dischargeLowRisk,
];
