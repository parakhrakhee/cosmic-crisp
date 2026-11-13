from datetime import datetime, date
from typing import Optional
from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Field(Base):
    __tablename__ = "fields"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    location_label: Mapped[str] = mapped_column(String(200), default="")
    geom: Mapped[object] = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)
    centroid_lat: Mapped[float] = mapped_column(Float, nullable=False)
    centroid_lon: Mapped[float] = mapped_column(Float, nullable=False)
    acreage: Mapped[float] = mapped_column(Float, nullable=False)
    previous_crops: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    soil_profile: Mapped[Optional["SoilProfile"]] = relationship(
        back_populates="field", uselist=False, cascade="all, delete-orphan"
    )
    activities: Mapped[list["FieldActivity"]] = relationship(
        back_populates="field", cascade="all, delete-orphan"
    )


class SoilProfile(Base):
    __tablename__ = "soil_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    field_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("fields.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    ph: Mapped[float] = mapped_column(Float, nullable=False, default=6.5)
    organic_matter_pct: Mapped[float] = mapped_column(Float, nullable=False, default=3.0)
    soil_texture: Mapped[str] = mapped_column(String(120), nullable=False, default="Loam")
    cec_meq: Mapped[float] = mapped_column(Float, nullable=False, default=16.0)
    salinity_dsm: Mapped[float] = mapped_column(Float, nullable=False, default=0.4)
    mean_slope_pct: Mapped[float] = mapped_column(Float, nullable=False, default=2.0)
    smap_rootzone_moisture: Mapped[int] = mapped_column(Integer, nullable=False, default=48)
    irrigated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source: Mapped[str] = mapped_column(String(120), nullable=False, default="USDA NRCS SSURGO")
    is_manual_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mukey: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    om_history: Mapped[list[dict]] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    field: Mapped["Field"] = relationship(back_populates="soil_profile")


class Crop(Base):
    __tablename__ = "crops"

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    botanical_family: Mapped[str] = mapped_column(String(64), nullable=False)
    is_cover_crop: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_legume: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    ph_min: Mapped[float] = mapped_column(Float, nullable=False)
    ph_max: Mapped[float] = mapped_column(Float, nullable=False)
    max_salinity_dsm: Mapped[float] = mapped_column(Float, nullable=False)
    gdd_required: Mapped[int] = mapped_column(Integer, nullable=False)
    frost_free_days_min: Mapped[int] = mapped_column(Integer, nullable=False)
    min_rotation_break_years: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    water_demand_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    n_balance_lbs_acre: Mapped[float] = mapped_column(Float, nullable=False)
    n_credit_provided_lbs_acre: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    root_type: Mapped[str] = mapped_column(String(32), nullable=False)
    seed_cost_per_acre: Mapped[float] = mapped_column(Float, nullable=False)
    fertilizer_n_req_lbs_acre: Mapped[float] = mapped_column(Float, nullable=False)
    base_irrigation_cost_per_acre: Mapped[float] = mapped_column(Float, nullable=False)
    projected_yield_units_acre: Mapped[float] = mapped_column(Float, nullable=False)
    yield_unit: Mapped[str] = mapped_column(String(24), nullable=False)
    regional_price_per_unit: Mapped[float] = mapped_column(Float, nullable=False)
    erosion_protection_score: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")


class TransitionMatrix(Base):
    __tablename__ = "transition_matrix"
    __table_args__ = (UniqueConstraint("prev_crop_id", "next_crop_id", name="uq_prev_next_crop"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    prev_crop_id: Mapped[str] = mapped_column(String(48), ForeignKey("crops.id"), nullable=False)
    next_crop_id: Mapped[str] = mapped_column(String(48), ForeignKey("crops.id"), nullable=False)
    baseline_score: Mapped[int] = mapped_column(Integer, nullable=False)


class TelemetryRecord(Base):
    __tablename__ = "climate_telemetry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    grid_key: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    obs_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    t2m_min: Mapped[float] = mapped_column(Float, nullable=False)
    t2m_max: Mapped[float] = mapped_column(Float, nullable=False)
    prectotcorr: Mapped[float] = mapped_column(Float, nullable=False)
    et0: Mapped[float] = mapped_column(Float, nullable=False)


class FieldActivity(Base):
    __tablename__ = "field_activities"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    field_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("fields.id", ondelete="CASCADE"), nullable=False
    )
    activity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    crop_name: Mapped[str] = mapped_column(String(100), nullable=False)
    activity_date: Mapped[str] = mapped_column(String(24), nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    n_applied_lbs_acre: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    field: Mapped["Field"] = relationship(back_populates="activities")
