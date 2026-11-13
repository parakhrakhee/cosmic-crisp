from datetime import datetime, timezone
import json
import uuid
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.shape import from_shape, to_shape
from pyproj import Geod
from shapely.geometry import mapping, shape
from shapely.validation import make_valid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.domain import Crop, Field, FieldActivity, SoilProfile, TransitionMatrix
from app.schemas.api import (
    ActivityCreateRequest,
    FieldCreateRequest,
    RotationGenerateRequest,
    SoilOverrideRequest,
)
from app.services.nasa_power import fetch_nasa_power_telemetry
from app.services.rotation_engine import run_rotation_engine
from app.services.usda_soil import fetch_usda_soil_profile

router = APIRouter()
GEOD = Geod(ellps="WGS84")


def _repair_and_measure_polygon(geojson_dict: Dict[str, Any]) -> tuple[Any, float, float, float]:
    geom = shape(geojson_dict)
    if not geom.is_valid:
        geom = make_valid(geom)
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda g: g.area)
    if geom.geom_type != "Polygon":
        raise HTTPException(status_code=400, detail="Geometry must resolve to a valid Polygon")
    area_m2, _ = GEOD.geometry_area_perimeter(geom)
    acres = round(abs(area_m2) * 0.000247105381, 2)
    centroid = geom.centroid
    return geom, acres, round(centroid.y, 5), round(centroid.x, 5)


async def _serialize_field(field: Field, telemetry: Dict[str, Any]) -> Dict[str, Any]:
    geom_shape = to_shape(field.geom)
    soil = field.soil_profile
    return {
        "id": field.id,
        "name": field.name,
        "location_label": field.location_label,
        "geometry": mapping(geom_shape),
        "centroid_lat": field.centroid_lat,
        "centroid_lon": field.centroid_lon,
        "acreage": field.acreage,
        "previous_crops": field.previous_crops,
        "soil": {
            "ph": soil.ph,
            "organic_matter_pct": soil.organic_matter_pct,
            "soil_texture": soil.soil_texture,
            "cec_meq": soil.cec_meq,
            "salinity_dsm": soil.salinity_dsm,
            "mean_slope_pct": soil.mean_slope_pct,
            "smap_rootzone_moisture": soil.smap_rootzone_moisture,
            "irrigated": soil.irrigated,
            "source": soil.source,
            "is_manual_override": soil.is_manual_override,
            "mukey": soil.mukey,
            "updated_at": soil.updated_at.isoformat() if soil.updated_at else "",
            "om_history": soil.om_history or [],
        },
        "telemetry": telemetry,
        "created_at": field.created_at.isoformat() if field.created_at else "",
        "updated_at": field.updated_at.isoformat() if field.updated_at else "",
    }


@router.get("/fields")
async def list_fields(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    stmt = select(Field).options(selectinload(Field.soil_profile)).order_by(Field.created_at.desc())
    fields = (await db.execute(stmt)).scalars().all()
    results = []
    for f in fields:
        tel = await fetch_nasa_power_telemetry(f.centroid_lat, f.centroid_lon)
        results.append(await _serialize_field(f, tel))
    return {"fields": results}


@router.post("/fields", status_code=201)
async def create_field(payload: FieldCreateRequest, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    geom, acres, lat, lon = _repair_and_measure_polygon(payload.geometry.model_dump())
    soil_dict, elev_m = await fetch_usda_soil_profile(lat, lon)
    if payload.mean_slope_pct is not None:
        soil_dict["mean_slope_pct"] = round(payload.mean_slope_pct, 1)
    if payload.smap_rootzone_moisture is not None:
        soil_dict["smap_rootzone_moisture"] = payload.smap_rootzone_moisture
    soil_dict["irrigated"] = payload.irrigated

    telemetry = await fetch_nasa_power_telemetry(lat, lon, elev_m)
    field_id = f"field-{uuid.uuid4().hex[:10]}"

    field_row = Field(
        id=field_id,
        name=payload.name.strip(),
        location_label=payload.location_label or f"{lat:.3f}N, {lon:.3f}E",
        geom=from_shape(geom, srid=4326),
        centroid_lat=lat,
        centroid_lon=lon,
        acreage=acres,
        previous_crops=payload.previous_crops or ["corn"],
    )
    current_year = datetime.now(timezone.utc).year
    soil_row = SoilProfile(
        field_id=field_id,
        ph=soil_dict["ph"],
        organic_matter_pct=soil_dict["organic_matter_pct"],
        soil_texture=soil_dict["soil_texture"],
        cec_meq=soil_dict["cec_meq"],
        salinity_dsm=soil_dict["salinity_dsm"],
        mean_slope_pct=soil_dict["mean_slope_pct"],
        smap_rootzone_moisture=soil_dict["smap_rootzone_moisture"],
        irrigated=soil_dict["irrigated"],
        source=soil_dict["source"],
        is_manual_override=False,
        mukey=soil_dict["mukey"],
        om_history=[
            {
                "season_year": current_year,
                "season_label": f"Fall {current_year}",
                "organic_matter_pct": soil_dict["organic_matter_pct"],
                "ph": soil_dict["ph"],
                "crop_grown": (payload.previous_crops or ["corn"])[0],
                "source": soil_dict["source"],
            }
        ],
    )
    db.add(field_row)
    db.add(soil_row)
    await db.commit()
    await db.refresh(field_row, ["soil_profile"])
    return {"field": await _serialize_field(field_row, telemetry)}


@router.put("/fields/{field_id}/soil")
async def override_field_soil(
    field_id: str, payload: SoilOverrideRequest, db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    stmt = select(Field).options(selectinload(Field.soil_profile)).where(Field.id == field_id)
    field = (await db.execute(stmt)).scalar_one_or_none()
    if not field or not field.soil_profile:
        raise HTTPException(status_code=404, detail="Field not found")

    soil = field.soil_profile
    soil.ph = round(payload.ph, 1)
    soil.organic_matter_pct = round(payload.organic_matter_pct, 1)
    soil.soil_texture = payload.soil_texture.strip()
    soil.cec_meq = round(payload.cec_meq, 1)
    soil.salinity_dsm = round(payload.salinity_dsm, 2)
    soil.mean_slope_pct = round(payload.mean_slope_pct, 1)
    soil.smap_rootzone_moisture = payload.smap_rootzone_moisture
    soil.irrigated = payload.irrigated
    soil.source = "Manual Lab Soil Test Override"
    soil.is_manual_override = True
    current_year = datetime.now(timezone.utc).year
    history = list(soil.om_history or [])
    new_point = {
        "season_year": current_year,
        "season_label": f"Fall {current_year}",
        "organic_matter_pct": soil.organic_matter_pct,
        "ph": soil.ph,
        "crop_grown": (field.previous_crops or ["Lab Core Sample"])[0],
        "source": "Manual Lab Override",
    }
    replaced = False
    for idx, item in enumerate(history):
        if item.get("season_year") == current_year:
            history[idx] = new_point
            replaced = True
            break
    if not replaced:
        history.append(new_point)
    history.sort(key=lambda x: x.get("season_year", 0))
    soil.om_history = history
    if payload.previous_crops:
        field.previous_crops = payload.previous_crops

    await db.commit()
    await db.refresh(field, ["soil_profile"])
    telemetry = await fetch_nasa_power_telemetry(field.centroid_lat, field.centroid_lon)
    return {"field": await _serialize_field(field, telemetry)}


@router.post("/rotations/generate")
async def generate_rotations(
    payload: RotationGenerateRequest, db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    stmt = select(Field).options(selectinload(Field.soil_profile)).where(Field.id == payload.field_id)
    field = (await db.execute(stmt)).scalar_one_or_none()
    if not field or not field.soil_profile:
        raise HTTPException(status_code=404, detail="Field not found")

    if payload.previous_crop_id:
        field.previous_crops = [payload.previous_crop_id, *field.previous_crops[1:]]
        await db.commit()

    crops = (await db.execute(select(Crop))).scalars().all()
    matrix_rows = (await db.execute(select(TransitionMatrix))).scalars().all()
    matrix: Dict[str, Dict[str, int]] = {}
    for row in matrix_rows:
        matrix.setdefault(row.prev_crop_id, {})[row.next_crop_id] = row.baseline_score

    telemetry = await fetch_nasa_power_telemetry(field.centroid_lat, field.centroid_lon)
    soil_dict = {
        "ph": field.soil_profile.ph,
        "salinity_dsm": field.soil_profile.salinity_dsm,
        "mean_slope_pct": field.soil_profile.mean_slope_pct,
        "smap_rootzone_moisture": field.soil_profile.smap_rootzone_moisture,
        "irrigated": field.soil_profile.irrigated,
    }
    return run_rotation_engine(
        field_id=field.id,
        field_name=field.name,
        crops=list(crops),
        matrix=matrix,
        soil=soil_dict,
        telemetry=telemetry,
        previous_crops=field.previous_crops,
    )


@router.get("/telemetry")
async def get_telemetry(
    field_id: Optional[str] = Query(default=None),
    lat: Optional[float] = Query(default=None),
    lon: Optional[float] = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    if field_id:
        field = await db.get(Field, field_id)
        if not field:
            raise HTTPException(status_code=404, detail="Field not found")
        return {"telemetry": await fetch_nasa_power_telemetry(field.centroid_lat, field.centroid_lon)}
    if lat is not None and lon is not None:
        return {"telemetry": await fetch_nasa_power_telemetry(lat, lon)}
    raise HTTPException(status_code=400, detail="Provide field_id or lat/lon")


@router.get("/activities")
async def list_activities(
    field_id: Optional[str] = Query(default=None), db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    stmt = select(FieldActivity)
    if field_id:
        stmt = stmt.where(FieldActivity.field_id == field_id)
    rows = (await db.execute(stmt.order_by(FieldActivity.activity_date.desc()))).scalars().all()
    return {
        "activities": [
            {
                "id": r.id,
                "field_id": r.field_id,
                "activity_type": r.activity_type,
                "crop_name": r.crop_name,
                "date": r.activity_date,
                "notes": r.notes,
                "n_applied_lbs_acre": r.n_applied_lbs_acre,
                "synced": True,
                "created_at": r.created_at.isoformat() if r.created_at else "",
            }
            for r in rows
        ]
    }


@router.post("/activities", status_code=201)
async def create_activity(
    payload: ActivityCreateRequest, db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    act_id = payload.id or f"act-{uuid.uuid4().hex[:10]}"
    existing = await db.get(FieldActivity, act_id)
    if existing:
        existing.activity_type = payload.activity_type
        existing.crop_name = payload.crop_name
        existing.activity_date = payload.date
        existing.notes = payload.notes
        existing.n_applied_lbs_acre = payload.n_applied_lbs_acre
        row = existing
    else:
        row = FieldActivity(
            id=act_id,
            field_id=payload.field_id,
            activity_type=payload.activity_type,
            crop_name=payload.crop_name,
            activity_date=payload.date,
            notes=payload.notes,
            n_applied_lbs_acre=payload.n_applied_lbs_acre,
        )
        db.add(row)
    await db.commit()
    return {
        "activity": {
            "id": row.id,
            "field_id": row.field_id,
            "activity_type": row.activity_type,
            "crop_name": row.crop_name,
            "date": row.activity_date,
            "notes": row.notes,
            "n_applied_lbs_acre": row.n_applied_lbs_acre,
            "synced": True,
            "created_at": row.created_at.isoformat() if row.created_at else "",
        }
    }
