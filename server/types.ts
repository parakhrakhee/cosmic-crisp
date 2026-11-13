export type BotanicalFamily =
  | 'Poaceae'
  | 'Fabaceae'
  | 'Brassicaceae'
  | 'Asteraceae/Solanaceae'
  | 'Fabaceae (Perennial)';

export type RootType = 'fibrous' | 'taproot' | 'tuber' | 'deep_taproot';

export interface CropSpec {
  id: string;
  name: string;
  botanical_family: BotanicalFamily;
  is_cover_crop: boolean;
  is_legume: boolean;
  ph_min: number;
  ph_max: number;
  max_salinity_dsm: number;
  gdd_required: number; // Base 10°C GDD (°C·days)
  frost_free_days_min: number;
  min_rotation_break_years: number;
  water_demand_mm: number;
  n_balance_lbs_acre: number; // Negative = uptake/demand, Positive = fixation
  n_credit_provided_lbs_acre: number; // Residual N credit to following crop
  root_type: RootType;
  seed_cost_per_acre: number;
  fertilizer_n_req_lbs_acre: number;
  base_irrigation_cost_per_acre: number;
  projected_yield_units_acre: number;
  yield_unit: string;
  regional_price_per_unit: number;
  erosion_protection_score: number; // 0-100
  description: string;
}

export interface SoilProfile {
  ph: number;
  organic_matter_pct: number;
  soil_texture: string;
  cec_meq: number;
  salinity_dsm: number;
  mean_slope_pct: number;
  smap_rootzone_moisture: number; // 0-100 percentile
  irrigated: boolean;
  source: string;
  is_manual_override: boolean;
  mukey?: string;
  updated_at: string;
}

export interface MonthlyClimatePoint {
  month: string;
  t_min_c: number;
  t_max_c: number;
  precip_mm: number;
  et0_mm: number;
  gdd_c: number;
}

export interface ClimateTelemetry {
  grid_lat: number;
  grid_lon: number;
  cache_key: string;
  cache_hit: boolean;
  cached_at: string;
  expires_at: string;
  data_source: 'NASA POWER API' | 'Climatology Fallback';
  gdd_85th_percentile: number;
  frost_free_days: number;
  annual_precip_mm: number;
  growing_season_precip_mm: number;
  mean_et0_mm_day: number;
  et0_method: 'NASA POWER ET0' | 'FAO-56 Hargreaves Computed';
  mean_t_min_c: number;
  mean_t_max_c: number;
  elevation_m: number;
  monthly_series: MonthlyClimatePoint[];
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface FieldRecord {
  id: string;
  name: string;
  location_label: string;
  geometry: GeoJsonPolygon;
  centroid_lat: number;
  centroid_lon: number;
  acreage: number;
  previous_crops: string[]; // Most recent first: [lastYear, twoYearsAgo, ...]
  soil: SoilProfile;
  telemetry: ClimateTelemetry;
  created_at: string;
  updated_at: string;
}

export interface GateAuditEntry {
  crop_id: string;
  crop_name: string;
  botanical_family: string;
  passed: boolean;
  gates: {
    ph_gate: { passed: boolean; detail: string };
    salinity_gate: { passed: boolean; detail: string };
    gdd_gate: { passed: boolean; detail: string };
    frost_free_gate: { passed: boolean; detail: string };
    disease_break_gate: { passed: boolean; detail: string };
  };
  rejection_reasons: string[];
}

export interface InjectedCoverCrop {
  crop_id: string;
  crop_name: string;
  trigger_reason: string;
  n_credit_lbs_acre: number;
  erosion_reduction_pct: number;
}

export interface YearPlanStep {
  year_index: number; // 1, 2, 3
  season_label: string; // e.g., "Year 1 (2027)"
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
  overwinter_cover_crops: InjectedCoverCrop[];
}

export interface RankedRotationPlan {
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
  steps: YearPlanStep[];
}

export interface RotationGenerationResponse {
  field_id: string;
  field_name: string;
  generated_at: string;
  beam_width: number;
  previous_crop: string;
  gate_audit_log: GateAuditEntry[];
  passing_crops_count: number;
  ranked_plans: RankedRotationPlan[];
}

export interface ActivityLogEntry {
  id: string;
  field_id: string;
  activity_type: 'Planting' | 'Soil Sample' | 'Cover Crop Termination' | 'Fertilizer Application' | 'Irrigation' | 'Field Observation';
  crop_name: string;
  date: string;
  notes: string;
  n_applied_lbs_acre?: number;
  synced: boolean;
  created_at: string;
}
