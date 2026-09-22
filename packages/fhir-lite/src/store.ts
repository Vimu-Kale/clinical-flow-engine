import type { PatientRecord, ResourceType } from './types.js';

/** How a `clinical-data` workflow node narrows and shapes a lookup. */
export interface ClinicalQuery {
  resource: ResourceType;
  /** Equality filter applied to own properties, e.g. `{ code: '2524-7' }`. */
  filter?: Record<string, string | number | boolean>;
  /**
   * - `all` (default) — every match, most recent first
   * - `latest` — the single most recent match, or null
   * - `value` — `valueQuantity.value` of the most recent match, or null
   * - `count` — how many matched
   * - `exists` — whether anything matched
   */
  select?: 'all' | 'latest' | 'value' | 'count' | 'exists';
}

/** The field each resource is ordered by, newest first. */
const DATE_KEY: Record<ResourceType, string | null> = {
  Patient: null,
  Observation: 'effectiveDateTime',
  Condition: 'onsetDateTime',
  MedicationRequest: 'authoredOn',
  Encounter: 'start',
  Coverage: null,
};

function ownValue(item: unknown, key: string): unknown {
  if (item === null || typeof item !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(item, key)) return undefined;
  return (item as Record<string, unknown>)[key];
}

/**
 * A read-only, in-memory stand-in for a FHIR server.
 *
 * Keeping the query surface this narrow is deliberate: it is the same shape a
 * real FHIR search would take, so swapping this for a live client is a handler
 * change rather than a pathway rewrite.
 */
export class ClinicalDataStore {
  private readonly records = new Map<string, PatientRecord>();

  constructor(records: Iterable<PatientRecord>) {
    for (const record of records) {
      this.records.set(record.patient.id, record);
    }
  }

  /** Patient ids held by this store, in insertion order. */
  patientIds(): string[] {
    return [...this.records.keys()];
  }

  record(patientId: string): PatientRecord | undefined {
    return this.records.get(patientId);
  }

  /** Runs a query and returns the shape asked for by `select`. */
  query(patientId: string, query: ClinicalQuery): unknown {
    const record = this.records.get(patientId);
    if (!record) {
      throw new Error(`Unknown patient "${patientId}"`);
    }

    if (query.resource === 'Patient') {
      return record.patient;
    }
    if (query.resource === 'Coverage') {
      return record.coverage;
    }

    const pool: unknown[] =
      query.resource === 'Observation'
        ? record.observations
        : query.resource === 'Condition'
          ? record.conditions
          : query.resource === 'MedicationRequest'
            ? record.medications
            : record.encounters;

    const filter = query.filter ?? {};
    const matches = pool.filter((item) =>
      Object.entries(filter).every(([key, value]) => ownValue(item, key) === value),
    );

    const dateKey = DATE_KEY[query.resource];
    if (dateKey) {
      matches.sort((a, b) => {
        const left = Date.parse(String(ownValue(a, dateKey) ?? ''));
        const right = Date.parse(String(ownValue(b, dateKey) ?? ''));
        return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left);
      });
    }

    switch (query.select ?? 'all') {
      case 'latest':
        return matches[0] ?? null;
      case 'value': {
        const quantity = ownValue(matches[0], 'valueQuantity');
        return ownValue(quantity, 'value') ?? null;
      }
      case 'count':
        return matches.length;
      case 'exists':
        return matches.length > 0;
      case 'all':
      default:
        return matches;
    }
  }
}
