import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { ActivityLogEntry, FieldRecord, GeoJsonPolygon } from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface GeometryRingMap {
  points: Array<{ lon: number; lat: number }>;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
  return cleaned || `id-${Date.now().toString(36)}`;
}

function polygonToRings(geometry: GeoJsonPolygon): GeometryRingMap[] {
  const rings = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
  return rings.slice(0, 10).map((ring) => ({
    points: ring.map(([lon, lat]) => ({
      lon: Number(lon),
      lat: Number(lat),
    })),
  }));
}

function ringsToPolygon(rings: GeometryRingMap[] | undefined): GeoJsonPolygon {
  if (!Array.isArray(rings) || rings.length === 0) {
    return {
      type: 'Polygon',
      coordinates: [
        [
          [-116.21, 43.61],
          [-116.19, 43.61],
          [-116.19, 43.62],
          [-116.21, 43.62],
          [-116.21, 43.61],
        ],
      ],
    };
  }
  return {
    type: 'Polygon',
    coordinates: rings.map((r) =>
      (r.points || []).map((pt) => [Number(pt.lon), Number(pt.lat)])
    ),
  };
}

function sanitizeFieldFields(field: FieldRecord) {
  const safeName = (field.name || 'Unnamed Field').trim().slice(0, 140);
  const safeLocation = (field.location_label || '').trim().slice(0, 160);
  const safeNotes = (field.notes || '').slice(0, 2000);
  const safePrevCrops = (
    Array.isArray(field.previous_crops) && field.previous_crops.length > 0
      ? field.previous_crops
      : ['corn']
  )
    .slice(0, 10)
    .map((c) => String(c).slice(0, 64));

  const safeYields = (Array.isArray(field.yields) ? field.yields : [])
    .slice(0, 50)
    .map((y) => ({
      id: sanitizeId(y.id || `y-${Date.now().toString(36)}`),
      year: Number(y.year),
      value: y.value === null || y.value === undefined ? null : Number(y.value),
      unit: y.unit,
    }));

  const safeStatus: 'pending' | 'analyzed' =
    field.analysis_status === 'pending' ? 'pending' : 'analyzed';

  const nowIso = new Date().toISOString();

  return {
    id: sanitizeId(field.id),
    name: safeName,
    location_label: safeLocation,
    geometryRings: polygonToRings(field.geometry),
    centroid_lat: Number(field.centroid_lat),
    centroid_lon: Number(field.centroid_lon),
    acreage: Math.max(0.01, Math.min(1000000, Number(field.acreage))),
    area_auto_calc: field.area_auto_calc !== false,
    notes: safeNotes,
    yields: safeYields,
    analysis_status: safeStatus,
    previous_crops: safePrevCrops,
    soil: stripUndefined(field.soil),
    telemetry: stripUndefined(field.telemetry),
    created_at: (field.created_at || nowIso).slice(0, 64),
    updated_at: (field.updated_at || nowIso).slice(0, 64),
  };
}

function docToFieldRecord(data: Record<string, unknown>): FieldRecord {
  const rings = data.geometryRings as GeometryRingMap[] | undefined;
  const legacyGeometry = data.geometry as GeoJsonPolygon | undefined;
  const geometry = rings ? ringsToPolygon(rings) : legacyGeometry || ringsToPolygon([]);

  return {
    id: String(data.id || ''),
    name: String(data.name || ''),
    location_label: String(data.location_label || ''),
    geometry,
    centroid_lat: Number(data.centroid_lat || 0),
    centroid_lon: Number(data.centroid_lon || 0),
    acreage: Number(data.acreage || 0),
    area_auto_calc: data.area_auto_calc !== false,
    notes: typeof data.notes === 'string' ? data.notes : '',
    yields: Array.isArray(data.yields) ? (data.yields as FieldRecord['yields']) : [],
    analysis_status: data.analysis_status === 'pending' ? 'pending' : 'analyzed',
    previous_crops: Array.isArray(data.previous_crops)
      ? (data.previous_crops as string[])
      : ['corn'],
    soil: data.soil as FieldRecord['soil'],
    telemetry: data.telemetry as FieldRecord['telemetry'],
    created_at: String(data.created_at || new Date().toISOString()),
    updated_at: String(data.updated_at || new Date().toISOString()),
  };
}

export async function ensureUserSeeded(
  uid: string,
  initialFields: FieldRecord[]
): Promise<void> {
  const userPath = `users/${uid}`;
  let userSnap;
  try {
    userSnap = await getDoc(doc(db, 'users', uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  if (userSnap.exists()) {
    return;
  }

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', uid), {
      uid: sanitizeId(uid),
      seededDemoFields: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const field of initialFields) {
      const sanitized = sanitizeFieldFields(field);
      batch.set(doc(db, 'fields', sanitized.id), {
        ...sanitized,
        ownerId: sanitizeId(uid),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'fields');
  }
}

export function subscribeUserFields(
  uid: string,
  onFields: (fields: FieldRecord[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const fieldsPath = 'fields';
  const q = query(collection(db, fieldsPath), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const records = snapshot.docs
        .map((d) => docToFieldRecord(d.data() as Record<string, unknown>))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      onFields(records);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, fieldsPath);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function createFieldInFirestore(
  uid: string,
  field: FieldRecord
): Promise<FieldRecord> {
  const sanitized = sanitizeFieldFields(field);
  const path = `fields/${sanitized.id}`;
  try {
    await setDoc(doc(db, 'fields', sanitized.id), {
      ...sanitized,
      ownerId: sanitizeId(uid),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docToFieldRecord(sanitized);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateFieldInFirestore(
  field: FieldRecord
): Promise<FieldRecord> {
  const sanitized = sanitizeFieldFields(field);
  const path = `fields/${sanitized.id}`;
  try {
    await updateDoc(doc(db, 'fields', sanitized.id), {
      name: sanitized.name,
      location_label: sanitized.location_label,
      geometryRings: sanitized.geometryRings,
      centroid_lat: sanitized.centroid_lat,
      centroid_lon: sanitized.centroid_lon,
      acreage: sanitized.acreage,
      area_auto_calc: sanitized.area_auto_calc,
      notes: sanitized.notes,
      yields: sanitized.yields,
      analysis_status: sanitized.analysis_status,
      previous_crops: sanitized.previous_crops,
      soil: sanitized.soil,
      telemetry: sanitized.telemetry,
      updated_at: sanitized.updated_at,
      updatedAt: serverTimestamp(),
    });
    return docToFieldRecord(sanitized);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteFieldFromFirestore(
  uid: string,
  fieldId: string
): Promise<void> {
  const safeFieldId = sanitizeId(fieldId);
  const path = `fields/${safeFieldId}`;
  try {
    const activitiesPath = `fields/${safeFieldId}/activities`;
    const actSnap = await getDocs(
      query(collection(db, activitiesPath), where('ownerId', '==', uid))
    );
    const batch = writeBatch(db);
    actSnap.forEach((actDoc) => {
      batch.delete(actDoc.ref);
    });
    batch.delete(doc(db, 'fields', safeFieldId));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeFieldActivities(
  uid: string,
  fieldId: string,
  onActivities: (activities: ActivityLogEntry[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const safeFieldId = sanitizeId(fieldId);
  const activitiesPath = `fields/${safeFieldId}/activities`;
  const q = query(collection(db, activitiesPath), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const entries = snapshot.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: String(data.id || d.id),
            field_id: String(data.field_id || safeFieldId),
            activity_type: data.activity_type as ActivityLogEntry['activity_type'],
            crop_name: String(data.crop_name || ''),
            date: String(data.date || ''),
            notes: typeof data.notes === 'string' ? data.notes : '',
            ...(typeof data.n_applied_lbs_acre === 'number'
              ? { n_applied_lbs_acre: data.n_applied_lbs_acre }
              : {}),
            synced: true,
            created_at: String(data.created_at || new Date().toISOString()),
          } satisfies ActivityLogEntry;
        })
        .sort((a, b) => b.date.localeCompare(a.date));
      onActivities(entries);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, activitiesPath);
      } catch (wrapped) {
        if (onError) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    }
  );
}

export async function saveActivityToFirestore(
  uid: string,
  entry: ActivityLogEntry
): Promise<ActivityLogEntry> {
  const safeFieldId = sanitizeId(entry.field_id);
  const safeActId = sanitizeId(entry.id);
  const path = `fields/${safeFieldId}/activities/${safeActId}`;
  const docPayload: Record<string, unknown> = {
    id: safeActId,
    ownerId: sanitizeId(uid),
    field_id: safeFieldId,
    activity_type: String(entry.activity_type).slice(0, 48),
    crop_name: String(entry.crop_name || 'Unknown Crop').slice(0, 120),
    date: String(entry.date).slice(0, 32),
    notes: String(entry.notes || '').slice(0, 1000),
    synced: true,
    created_at: (entry.created_at || new Date().toISOString()).slice(0, 64),
    createdAt: serverTimestamp(),
  };

  if (
    typeof entry.n_applied_lbs_acre === 'number' &&
    Number.isFinite(entry.n_applied_lbs_acre)
  ) {
    docPayload.n_applied_lbs_acre = Math.max(
      0,
      Math.min(1000, entry.n_applied_lbs_acre)
    );
  }

  try {
    await setDoc(doc(db, 'fields', safeFieldId, 'activities', safeActId), docPayload);
    return { ...entry, id: safeActId, field_id: safeFieldId, synced: true };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}
