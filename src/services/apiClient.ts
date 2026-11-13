import {
  cacheFieldsOffline,
  cacheRotationOffline,
  deleteOfflineField,
  getOfflineActivities,
  getOfflineFields,
  getOfflineRotation,
  saveActivityOffline,
} from '../db/offlineDb';
import { auth } from '../firebase';
import {
  createFieldInFirestore,
  deleteFieldFromFirestore,
  saveActivityToFirestore,
  updateFieldInFirestore,
} from './firestoreSync';
import type {
  ActivityLogEntry,
  ClimateTelemetry,
  CropSpec,
  FieldRecord,
  GeoJsonPolygon,
  RotationGenerationResponse,
  YieldRecord,
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

export interface FieldSavePayload {
  name: string;
  location_label?: string;
  geometry: GeoJsonPolygon;
  previous_crops: string[];
  irrigated: boolean;
  area_auto_calc?: boolean;
  area_ha?: number;
  acreage?: number;
  notes?: string;
  yields?: YieldRecord[];
  analysis_status?: 'pending' | 'analyzed';
  ph?: number;
  organic_matter_pct?: number;
  salinity_dsm?: number;
  soil_texture?: string;
  cec_meq?: number;
  mean_slope_pct?: number;
  smap_rootzone_moisture?: number;
}

export async function createField(payload: FieldSavePayload): Promise<FieldRecord> {
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
  let savedField = data.field;

  if (auth.currentUser) {
    savedField = await createFieldInFirestore(auth.currentUser.uid, savedField);
  }

  await cacheFieldsOffline([savedField]);
  return savedField;
}

export async function updateField(
  fieldId: string,
  payload: Partial<FieldSavePayload>,
  existingField?: FieldRecord | null
): Promise<FieldRecord> {
  const res = await fetch(`${API_BASE}/fields/${encodeURIComponent(fieldId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      ...(existingField ? { existing_field: existingField } : {}),
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to update field');
  }
  const data = (await res.json()) as { field: FieldRecord };
  let updatedField = data.field;

  if (auth.currentUser) {
    updatedField = await updateFieldInFirestore(updatedField);
  }

  await cacheFieldsOffline([updatedField]);
  return updatedField;
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
  },
  existingField?: FieldRecord | null
): Promise<FieldRecord> {
  const res = await fetch(`${API_BASE}/fields/${encodeURIComponent(fieldId)}/soil`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      ...(existingField ? { existing_field: existingField } : {}),
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to update soil profile');
  }
  const data = (await res.json()) as { field: FieldRecord };
  let updatedField = data.field;

  if (auth.currentUser) {
    updatedField = await updateFieldInFirestore(updatedField);
  }

  await cacheFieldsOffline([updatedField]);
  return updatedField;
}

export async function deleteField(fieldId: string): Promise<void> {
  if (auth.currentUser) {
    await deleteFieldFromFirestore(auth.currentUser.uid, fieldId);
  }
  await fetch(`${API_BASE}/fields/${encodeURIComponent(fieldId)}`, {
    method: 'DELETE',
  }).catch(() => undefined);
  await deleteOfflineField(fieldId);
}

export async function refreshFieldTelemetry(
  fieldOrId: FieldRecord | string
): Promise<ClimateTelemetry> {
  const isObj = typeof fieldOrId !== 'string';
  const url = isObj
    ? `${API_BASE}/telemetry?lat=${encodeURIComponent(fieldOrId.centroid_lat)}&lon=${encodeURIComponent(fieldOrId.centroid_lon)}&elevation_m=${encodeURIComponent(fieldOrId.telemetry.elevation_m)}`
    : `${API_BASE}/telemetry?field_id=${encodeURIComponent(fieldOrId)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to refresh NASA POWER telemetry');
  const data = (await res.json()) as { telemetry: ClimateTelemetry };

  if (isObj && auth.currentUser) {
    const updatedField: FieldRecord = {
      ...fieldOrId,
      telemetry: data.telemetry,
      updated_at: new Date().toISOString(),
    };
    await updateFieldInFirestore(updatedField);
    await cacheFieldsOffline([updatedField]);
  }

  return data.telemetry;
}

export async function generateRotations(
  fieldOrId: FieldRecord | string,
  previousCropId?: string
): Promise<{ result: RotationGenerationResponse; fromOfflineCache: boolean }> {
  const isObj = typeof fieldOrId !== 'string';
  const fieldId = isObj ? fieldOrId.id : fieldOrId;
  try {
    const res = await fetch(`${API_BASE}/rotations/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        field_id: fieldId,
        previous_crop_id: previousCropId,
        ...(isObj ? { field: fieldOrId } : {}),
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

export async function logActivity(
  entry: Omit<ActivityLogEntry, 'id' | 'synced' | 'created_at'>
): Promise<ActivityLogEntry> {
  const localEntry: ActivityLogEntry = {
    ...entry,
    id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    synced: false,
    created_at: new Date().toISOString(),
  };

  await saveActivityOffline(localEntry);

  if (auth.currentUser) {
    try {
      const cloudSaved = await saveActivityToFirestore(auth.currentUser.uid, localEntry);
      await saveActivityOffline(cloudSaved);
      return cloudSaved;
    } catch (err) {
      console.error('Failed to sync activity to Firestore:', err);
    }
  }

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
      if (auth.currentUser) {
        const cloudSaved = await saveActivityToFirestore(auth.currentUser.uid, act);
        await saveActivityOffline(cloudSaved);
        syncedCount += 1;
      } else {
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
      }
    } catch {
      // Remain queued offline
    }
  }
  return syncedCount;
}
