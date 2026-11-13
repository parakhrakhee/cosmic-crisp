import Dexie, { type Table } from 'dexie';
import type { ActivityLogEntry, FieldRecord, RotationGenerationResponse } from '../types';

export interface CachedRotationRecord {
  field_id: string;
  cached_at: string;
  payload: RotationGenerationResponse;
}

class CosmicCrispOfflineDB extends Dexie {
  fields!: Table<FieldRecord, string>;
  rotations!: Table<CachedRotationRecord, string>;
  activities!: Table<ActivityLogEntry, string>;

  constructor() {
    super('cosmic_crisp_offline_v1');
    this.version(1).stores({
      fields: 'id, updated_at',
      rotations: 'field_id, cached_at',
      activities: 'id, field_id, date, synced',
    });
  }
}

export const offlineDb = new CosmicCrispOfflineDB();

export async function cacheFieldsOffline(fields: FieldRecord[]): Promise<void> {
  await offlineDb.fields.bulkPut(fields);
}

export async function replaceOfflineFields(fields: FieldRecord[]): Promise<void> {
  await offlineDb.transaction('rw', offlineDb.fields, async () => {
    await offlineDb.fields.clear();
    if (fields.length > 0) {
      await offlineDb.fields.bulkPut(fields);
    }
  });
}

export async function deleteOfflineField(fieldId: string): Promise<void> {
  await offlineDb.transaction('rw', offlineDb.fields, offlineDb.rotations, offlineDb.activities, async () => {
    await offlineDb.fields.delete(fieldId);
    await offlineDb.rotations.delete(fieldId);
    await offlineDb.activities.where('field_id').equals(fieldId).delete();
  });
}

export async function getOfflineFields(): Promise<FieldRecord[]> {
  return offlineDb.fields.orderBy('updated_at').reverse().toArray();
}

export async function cacheRotationOffline(plan: RotationGenerationResponse): Promise<void> {
  await offlineDb.rotations.put({
    field_id: plan.field_id,
    cached_at: new Date().toISOString(),
    payload: plan,
  });
}

export async function getOfflineRotation(
  fieldId: string
): Promise<RotationGenerationResponse | null> {
  const row = await offlineDb.rotations.get(fieldId);
  return row ? row.payload : null;
}

export async function saveActivityOffline(entry: ActivityLogEntry): Promise<void> {
  await offlineDb.activities.put(entry);
}

export async function getOfflineActivities(fieldId?: string): Promise<ActivityLogEntry[]> {
  if (fieldId) {
    return offlineDb.activities.where('field_id').equals(fieldId).reverse().sortBy('date');
  }
  return offlineDb.activities.orderBy('date').reverse().toArray();
}
