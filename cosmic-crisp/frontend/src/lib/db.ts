import Dexie, { type Table } from 'dexie';
import type {
  ActivityRecord,
  FieldResponseDTO,
  RotationGenerateResponse,
  SoilProfileDTO,
} from './api';

export interface CachedSoilRecord extends SoilProfileDTO {
  field_id: string;
}

export interface CachedRotationRecord {
  field_id: string;
  cached_at: string;
  response: RotationGenerateResponse;
}

class CosmicCrispIndexedDB extends Dexie {
  fields!: Table<FieldResponseDTO, string>;
  soil_profiles!: Table<CachedSoilRecord, string>;
  rotation_plans!: Table<CachedRotationRecord, string>;
  activity_queue!: Table<ActivityRecord, string>;

  constructor() {
    super('cosmic_crisp_offline_db');
    this.version(1).stores({
      fields: 'id, updated_at',
      soil_profiles: 'field_id, updated_at',
      rotation_plans: 'field_id, cached_at',
      activity_queue: 'id, field_id, date, synced',
    });
  }
}

export const db = new CosmicCrispIndexedDB();

export async function cacheFieldsAndSoils(fields: FieldResponseDTO[]): Promise<void> {
  if (fields.length === 0) return;
  await db.fields.bulkPut(fields);
  await db.soil_profiles.bulkPut(
    fields.map((f) => ({
      field_id: f.id,
      ...f.soil,
    }))
  );
}

export async function getCachedFields(): Promise<FieldResponseDTO[]> {
  return db.fields.orderBy('updated_at').reverse().toArray();
}

export async function cacheSoilProfile(fieldId: string, soil: SoilProfileDTO): Promise<void> {
  await db.soil_profiles.put({ field_id: fieldId, ...soil });
  const existing = await db.fields.get(fieldId);
  if (existing) {
    await db.fields.put({ ...existing, soil, updated_at: soil.updated_at });
  }
}

export async function cacheRotationPlan(response: RotationGenerateResponse): Promise<void> {
  await db.rotation_plans.put({
    field_id: response.field_id,
    cached_at: new Date().toISOString(),
    response,
  });
}

export async function getCachedRotationPlan(
  fieldId: string
): Promise<RotationGenerateResponse | null> {
  const row = await db.rotation_plans.get(fieldId);
  return row ? row.response : null;
}

export async function upsertActivitiesOffline(records: ActivityRecord[]): Promise<void> {
  if (records.length === 0) return;
  await db.activity_queue.bulkPut(records);
}

export async function getCachedActivities(fieldId: string): Promise<ActivityRecord[]> {
  const rows = await db.activity_queue.where('field_id').equals(fieldId).toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
