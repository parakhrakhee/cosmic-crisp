import {
  cacheFieldsAndSoils,
  cacheRotationPlan,
  cacheSoilProfile,
  getCachedActivities,
  getCachedFields,
  getCachedRotationPlan,
  upsertActivitiesOffline,
} from './db';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
const API_V1 = `${API_ORIGIN}/api/v1`;

/* -------------------------------------------------------------------------- */
/* Exact Phase 1 Pydantic Schema DTOs                                         */
/* -------------------------------------------------------------------------- */

export interface GeoJsonPolygonDTO {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface SoilHistoryPointDTO {
  season_year: number;
  season_label: string;
  organic_matter_pct: number;
  ph: number;
  crop_grown: string;
  source: string;
}

export interface SoilProfileDTO {
  ph: number;
  organic_matter_pct: number;
  soil_texture: string;
  cec_meq: number;
  salinity_dsm: number;
  mean_slope_pct: number;
  smap_rootzone_moisture: number;
  irrigated: boolean;
  source: string;
  is_manual_override: boolean;
  mukey?: string | null;
  updated_at: string;
  om_history?: SoilHistoryPointDTO[];
}

export interface SoilOverrideRequest {
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

export interface MonthlyClimatePointDTO {
  month: string;
  t_min_c: number;
  t_max_c: number;
  precip_mm: number;
  et0_mm: number;
  gdd_c: number;
}

export interface ClimateTelemetryDTO {
  grid_lat: number;
  grid_lon: number;
  cache_key: string;
  cache_hit: boolean;
  cached_at: string;
  expires_at: string;
  data_source: string;
  gdd_85th_percentile: number;
  frost_free_days: number;
  annual_precip_mm: number;
  growing_season_precip_mm: number;
  mean_et0_mm_day: number;
  et0_method: string;
  mean_t_min_c: number;
  mean_t_max_c: number;
  elevation_m: number;
  monthly_series: MonthlyClimatePointDTO[];
}

export interface FieldCreateRequest {
  name: string;
  location_label?: string;
  geometry: GeoJsonPolygonDTO;
  previous_crops: string[];
  irrigated: boolean;
  mean_slope_pct?: number;
  smap_rootzone_moisture?: number;
}

export interface FieldResponseDTO {
  id: string;
  name: string;
  location_label: string;
  geometry: GeoJsonPolygonDTO;
  centroid_lat: number;
  centroid_lon: number;
  acreage: number;
  previous_crops: string[];
  soil: SoilProfileDTO;
  telemetry: ClimateTelemetryDTO;
  created_at: string;
  updated_at: string;
}

export interface GateCheckDTO {
  passed: boolean;
  detail: string;
}

export interface GateAuditEntryDTO {
  crop_id: string;
  crop_name: string;
  botanical_family: string;
  passed: boolean;
  gates: Record<string, GateCheckDTO>;
  rejection_reasons: string[];
}

export interface InjectedCoverCropDTO {
  crop_id: string;
  crop_name: string;
  trigger_reason: string;
  n_credit_lbs_acre: number;
  erosion_reduction_pct: number;
}

export interface YearPlanStepDTO {
  year_index: number;
  season_label: string;
  crop_id: string;
  crop_name: string;
  botanical_family: string;
  baseline_transition_score: number;
  s_soil: number;
  s_pest: number;
  s_water: number;
  s_econ: number;
  total_score: number;
  legume_n_credit_applied_lbs_acre: number;
  fertilizer_savings_usd_acre: number;
  smap_penalty_applied: number;
  net_n_balance_lbs_acre: number;
  cumulative_2yr_n_balance_lbs_acre: number;
  projected_revenue_usd_acre: number;
  projected_cost_usd_acre: number;
  net_margin_usd_acre: number;
  rationale: string;
  overwinter_cover_crops: InjectedCoverCropDTO[];
}

export interface RankedRotationPlanDTO {
  rank: number;
  plan_id: string;
  composite_3yr_score: number;
  avg_s_soil: number;
  avg_s_pest: number;
  avg_s_water: number;
  avg_s_econ: number;
  cumulative_3yr_net_margin_usd_acre: number;
  cumulative_3yr_n_balance_lbs_acre: number;
  total_fertilizer_savings_usd_acre: number;
  cover_crop_injections_count: number;
  steps: YearPlanStepDTO[];
}

export interface RotationGenerateRequest {
  field_id: string;
  previous_crop_id?: string;
}

export interface RotationGenerateResponse {
  field_id: string;
  field_name: string;
  generated_at: string;
  beam_width: number;
  previous_crop: string;
  gate_audit_log: GateAuditEntryDTO[];
  passing_crops_count: number;
  ranked_plans: RankedRotationPlanDTO[];
}

export interface ActivityCreateRequest {
  id?: string;
  field_id: string;
  activity_type: string;
  crop_name: string;
  date: string;
  notes: string;
  n_applied_lbs_acre?: number;
}

export interface ActivityRecord {
  id: string;
  field_id: string;
  activity_type: string;
  crop_name: string;
  date: string;
  notes: string;
  n_applied_lbs_acre?: number | null;
  synced: boolean;
  created_at: string;
}

export const PRIMARY_CROPS = [
  { id: 'corn', name: 'Corn (Maize)' },
  { id: 'soybeans', name: 'Soybeans / Pulses' },
  { id: 'winter_wheat', name: 'Winter Wheat / Barley' },
  { id: 'canola', name: 'Canola / Mustard' },
  { id: 'sunflower_potato', name: 'Sunflower / Potato' },
  { id: 'alfalfa_clover', name: 'Alfalfa / Clover' },
] as const;

/* -------------------------------------------------------------------------- */
/* Typed Fetch Wrappers with Automatic IndexedDB Offline Fallback             */
/* -------------------------------------------------------------------------- */

async function parseError(res: Response, fallbackMsg: string): Promise<never> {
  let detail = fallbackMsg;
  try {
    const body = (await res.json()) as { detail?: string; error?: string };
    detail = body.detail || body.error || fallbackMsg;
  } catch {
    // keep fallbackMsg
  }
  throw new Error(detail);
}

export async function listFields(): Promise<{
  fields: FieldResponseDTO[];
  offline: boolean;
}> {
  try {
    const res = await fetch(`${API_V1}/fields`, { cache: 'no-store' });
    if (!res.ok) await parseError(res, `Failed to load fields (${res.status})`);
    const data = (await res.json()) as { fields: FieldResponseDTO[] };
    await cacheFieldsAndSoils(data.fields);
    return { fields: data.fields, offline: false };
  } catch {
    const cached = await getCachedFields();
    return { fields: cached, offline: true };
  }
}

export async function createField(payload: FieldCreateRequest): Promise<FieldResponseDTO> {
  const res = await fetch(`${API_V1}/fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res, 'Failed to create field parcel');
  const data = (await res.json()) as { field: FieldResponseDTO };
  await cacheFieldsAndSoils([data.field]);
  return data.field;
}

export async function overrideFieldSoil(
  fieldId: string,
  payload: SoilOverrideRequest
): Promise<FieldResponseDTO> {
  const res = await fetch(`${API_V1}/fields/${encodeURIComponent(fieldId)}/soil`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res, 'Failed to save soil lab override');
  const data = (await res.json()) as { field: FieldResponseDTO };
  await cacheSoilProfile(fieldId, data.field.soil);
  await cacheFieldsAndSoils([data.field]);
  return data.field;
}

export async function generateRotations(
  payload: RotationGenerateRequest
): Promise<{ result: RotationGenerateResponse; offline: boolean }> {
  try {
    const res = await fetch(`${API_V1}/rotations/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) await parseError(res, 'Failed to generate 3-year rotation plans');
    const result = (await res.json()) as RotationGenerateResponse;
    await cacheRotationPlan(result);
    return { result, offline: false };
  } catch (err) {
    const cached = await getCachedRotationPlan(payload.field_id);
    if (cached) {
      return { result: cached, offline: true };
    }
    throw err;
  }
}

export async function listActivities(fieldId: string): Promise<{
  activities: ActivityRecord[];
  offline: boolean;
}> {
  try {
    const res = await fetch(
      `${API_V1}/activities?field_id=${encodeURIComponent(fieldId)}`,
      { cache: 'no-store' }
    );
    if (!res.ok) await parseError(res, 'Failed to load activities');
    const data = (await res.json()) as { activities: ActivityRecord[] };
    await upsertActivitiesOffline(data.activities.map((a) => ({ ...a, synced: true })));
    const merged = await getCachedActivities(fieldId);
    return { activities: merged, offline: false };
  } catch {
    const cached = await getCachedActivities(fieldId);
    return { activities: cached, offline: true };
  }
}

export async function createActivity(payload: ActivityCreateRequest): Promise<ActivityRecord> {
  const localRecord: ActivityRecord = {
    id: payload.id || `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    field_id: payload.field_id,
    activity_type: payload.activity_type,
    crop_name: payload.crop_name,
    date: payload.date,
    notes: payload.notes,
    n_applied_lbs_acre: payload.n_applied_lbs_acre ?? null,
    synced: false,
    created_at: new Date().toISOString(),
  };

  await upsertActivitiesOffline([localRecord]);

  try {
    const res = await fetch(`${API_V1}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, id: localRecord.id }),
    });
    if (!res.ok) throw new Error('Sync deferred');
    const data = (await res.json()) as { activity: ActivityRecord };
    const syncedRecord: ActivityRecord = { ...data.activity, synced: true };
    await upsertActivitiesOffline([syncedRecord]);
    return syncedRecord;
  } catch {
    return localRecord;
  }
}

export async function syncQueuedActivities(fieldId: string): Promise<number> {
  const cached = await getCachedActivities(fieldId);
  const pending = cached.filter((a) => !a.synced);
  let syncedCount = 0;

  for (const act of pending) {
    try {
      const res = await fetch(`${API_V1}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: act.id,
          field_id: act.field_id,
          activity_type: act.activity_type,
          crop_name: act.crop_name,
          date: act.date,
          notes: act.notes,
          n_applied_lbs_acre: act.n_applied_lbs_acre ?? undefined,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { activity: ActivityRecord };
        await upsertActivitiesOffline([{ ...data.activity, synced: true }]);
        syncedCount += 1;
      }
    } catch {
      // Remain queued in IndexedDB until connectivity returns
    }
  }
  return syncedCount;
}
