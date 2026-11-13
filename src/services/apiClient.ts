import {
  cacheFieldsOffline,
  cacheRotationOffline,
  getOfflineActivities,
  getOfflineFields,
  getOfflineRotation,
  saveActivityOffline,
} from '../db/offlineDb';
import type {
  ActivityLogEntry,
  ClimateTelemetry,
  CropSpec,
  FieldRecord,
  GeoJsonPolygon,
  RotationGenerationResponse,
} from '../types';

const API_BASE = '/api/v1';

export async function fetchFields(): Promise<{ fields: FieldRecord[]; fromOfflineCache: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/fields`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { fields: FieldRecord[] };
    await cacheFieldsOffline(data.fields);
    return { fields: data.fields, fromOfflineCache: false };
  } catch {
    const cached = await getOfflineFields();
    return { fields: cached, fromOfflineCache: true };
  }
}

export async function createField(payload: {
  name: string;
  location_label?: string;
  geometry: GeoJsonPolygon;
  previous_crops: string[];
  irrigated: boolean;
  mean_slope_pct?: number;
  smap_rootzone_moisture?: number;
}): Promise<FieldRecord> {
  const res = await fetch(`${API_BASE}/fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to save field');
  }
  const data = (await res.json()) as { field: FieldRecord };
  await cacheFieldsOffline([data.field]);
  return data.field;
}

export async function updateFieldSoil(
  fieldId: string,
  payload: {
    ph: number;
    organic_matter_pct: number;
    soil_texture: string;
    cec_meq: number;
    salinity_dsm: number;
    mean_slope_pct: number;
    smap_rootzone_moisture: number;
    irrigated: boolean;
    previous_crops?: string[];
  }
): Promise<FieldRecord> {
  const res = await fetch(`${API_BASE}/fields/${fieldId}/soil`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to update soil profile');
  }
  const data = (await res.json()) as { field: FieldRecord };
  await cacheFieldsOffline([data.field]);
  return data.field;
}

export async function deleteField(fieldId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/fields/${fieldId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete field');
}

export async function refreshFieldTelemetry(fieldId: string): Promise<ClimateTelemetry> {
  const res = await fetch(`${API_BASE}/telemetry?field_id=${encodeURIComponent(fieldId)}`);
  if (!res.ok) throw new Error('Failed to refresh NASA POWER telemetry');
  const data = (await res.json()) as { telemetry: ClimateTelemetry };
  return data.telemetry;
}

export async function generateRotations(
  fieldId: string,
  previousCropId?: string
): Promise<{ result: RotationGenerationResponse; fromOfflineCache: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/rotations/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        field_id: fieldId,
        previous_crop_id: previousCropId,
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || 'Rotation generation failed');
    }
    const data = (await res.json()) as RotationGenerationResponse;
    await cacheRotationOffline(data);
    return { result: data, fromOfflineCache: false };
  } catch (err) {
    const cached = await getOfflineRotation(fieldId);
    if (cached) {
      return { result: cached, fromOfflineCache: true };
    }
    throw err;
  }
}

export async function fetchMatrixAndCrops(): Promise<{
  crops: CropSpec[];
  cover_crops: CropSpec[];
  matrix: Record<string, Record<string, number>>;
}> {
  const res = await fetch(`${API_BASE}/matrix`);
  if (!res.ok) throw new Error('Failed to fetch compatibility matrix');
  return res.json();
}

export async function fetchActivities(fieldId: string): Promise<ActivityLogEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/activities?field_id=${encodeURIComponent(fieldId)}`);
    if (!res.ok) throw new Error('Offline');
    const data = (await res.json()) as { activities: ActivityLogEntry[] };
    for (const act of data.activities) {
      await saveActivityOffline(act);
    }
    return getOfflineActivities(fieldId);
  } catch {
    return getOfflineActivities(fieldId);
  }
}

export async function logActivity(entry: Omit<ActivityLogEntry, 'id' | 'synced' | 'created_at'>): Promise<ActivityLogEntry> {
  const localEntry: ActivityLogEntry = {
    ...entry,
    id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    synced: false,
    created_at: new Date().toISOString(),
  };

  await saveActivityOffline(localEntry);

  try {
    const res = await fetch(`${API_BASE}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(localEntry),
    });
    if (!res.ok) throw new Error('Server sync failed');
    const data = (await res.json()) as { activity: ActivityLogEntry };
    await saveActivityOffline(data.activity);
    return data.activity;
  } catch {
    return localEntry;
  }
}

export async function syncPendingActivities(fieldId: string): Promise<number> {
  const all = await getOfflineActivities(fieldId);
  const pending = all.filter((a) => !a.synced);
  let syncedCount = 0;
  for (const act of pending) {
    try {
      const res = await fetch(`${API_BASE}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(act),
      });
      if (res.ok) {
        const data = (await res.json()) as { activity: ActivityLogEntry };
        await saveActivityOffline(data.activity);
        syncedCount += 1;
      }
    } catch {
      // Remain queued offline
    }
  }
  return syncedCount;
}
