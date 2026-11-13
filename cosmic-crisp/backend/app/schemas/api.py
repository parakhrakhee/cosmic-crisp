from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field as PydanticField, field_validator


class GeoJsonPolygonDTO(BaseModel):
    type: Literal["Polygon"]
    coordinates: List[List[List[float]]]

    @field_validator("coordinates")
    @classmethod
    def validate_rings(cls, v: List[List[List[float]]]) -> List[List[List[float]]]:
        if not v or len(v[0]) < 4:
            raise ValueError("GeoJSON Polygon exterior ring must contain at least 4 coordinates")
        return v


class SoilProfileDTO(BaseModel):
    ph: float
    organic_matter_pct: float
    soil_texture: str
    cec_meq: float
    salinity_dsm: float
    mean_slope_pct: float
    smap_rootzone_moisture: int
    irrigated: bool
    source: str
    is_manual_override: bool
    mukey: Optional[str] = None
    updated_at: str


class SoilOverrideRequest(BaseModel):
    ph: float = PydanticField(..., ge=3.5, le=9.5)
    organic_matter_pct: float = PydanticField(..., ge=0.1, le=30.0)
    soil_texture: str = PydanticField(..., min_length=2, max_length=120)
    cec_meq: float = PydanticField(..., ge=1.0, le=80.0)
    salinity_dsm: float = PydanticField(..., ge=0.0, le=20.0)
    mean_slope_pct: float = PydanticField(..., ge=0.0, le=45.0)
    smap_rootzone_moisture: int = PydanticField(..., ge=0, le=100)
    irrigated: bool = False
    previous_crops: Optional[List[str]] = None


class MonthlyClimatePointDTO(BaseModel):
    month: str
    t_min_c: float
    t_max_c: float
    precip_mm: float
    et0_mm: float
    gdd_c: float


class ClimateTelemetryDTO(BaseModel):
    grid_lat: float
    grid_lon: float
    cache_key: str
    cache_hit: bool
    cached_at: str
    expires_at: str
    data_source: str
    gdd_85th_percentile: int
    frost_free_days: int
    annual_precip_mm: int
    growing_season_precip_mm: int
    mean_et0_mm_day: float
    et0_method: str
    mean_t_min_c: float
    mean_t_max_c: float
    elevation_m: int
    monthly_series: List[MonthlyClimatePointDTO]


class FieldCreateRequest(BaseModel):
    name: str = PydanticField(..., min_length=1, max_length=160)
    location_label: Optional[str] = None
    geometry: GeoJsonPolygonDTO
    previous_crops: List[str] = PydanticField(default_factory=lambda: ["corn"])
    irrigated: bool = False
    mean_slope_pct: Optional[float] = None
    smap_rootzone_moisture: Optional[int] = None


class FieldResponseDTO(BaseModel):
    id: str
    name: str
    location_label: str
    geometry: GeoJsonPolygonDTO
    centroid_lat: float
    centroid_lon: float
    acreage: float
    previous_crops: List[str]
    soil: SoilProfileDTO
    telemetry: ClimateTelemetryDTO
    created_at: str
    updated_at: str


class GateCheckDTO(BaseModel):
    passed: bool
    detail: str


class GateAuditEntryDTO(BaseModel):
    crop_id: str
    crop_name: str
    botanical_family: str
    passed: bool
    gates: Dict[str, GateCheckDTO]
    rejection_reasons: List[str]


class InjectedCoverCropDTO(BaseModel):
    crop_id: str
    crop_name: str
    trigger_reason: str
    n_credit_lbs_acre: float
    erosion_reduction_pct: int


class YearPlanStepDTO(BaseModel):
    year_index: int
    season_label: str
    crop_id: str
    crop_name: str
    botanical_family: str
    baseline_transition_score: int
    s_soil: float
    s_pest: float
    s_water: float
    s_econ: float
    total_score: float
    legume_n_credit_applied_lbs_acre: float
    fertilizer_savings_usd_acre: float
    smap_penalty_applied: float
    net_n_balance_lbs_acre: float
    cumulative_2yr_n_balance_lbs_acre: float
    projected_revenue_usd_acre: float
    projected_cost_usd_acre: float
    net_margin_usd_acre: float
    rationale: str
    overwinter_cover_crops: List[InjectedCoverCropDTO]


class RankedRotationPlanDTO(BaseModel):
    rank: int
    plan_id: str
    composite_3yr_score: float
    avg_s_soil: float
    avg_s_pest: float
    avg_s_water: float
    avg_s_econ: float
    cumulative_3yr_net_margin_usd_acre: float
    cumulative_3yr_n_balance_lbs_acre: float
    total_fertilizer_savings_usd_acre: float
    cover_crop_injections_count: int
    steps: List[YearPlanStepDTO]


class RotationGenerateRequest(BaseModel):
    field_id: str
    previous_crop_id: Optional[str] = None


class RotationGenerateResponse(BaseModel):
    field_id: str
    field_name: str
    generated_at: str
    beam_width: int
    previous_crop: str
    gate_audit_log: List[GateAuditEntryDTO]
    passing_crops_count: int
    ranked_plans: List[RankedRotationPlanDTO]


class ActivityCreateRequest(BaseModel):
    id: Optional[str] = None
    field_id: str
    activity_type: str
    crop_name: str
    date: str
    notes: str = ""
    n_applied_lbs_acre: Optional[float] = None
