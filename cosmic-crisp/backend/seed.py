import asyncio
from sqlalchemy import select, text
from app.core.database import AsyncSessionLocal, Base, engine
from app.models.domain import Crop, TransitionMatrix

CROP_SEED_DATA = [
    {
        "id": "corn",
        "name": "Corn (Maize)",
        "botanical_family": "Poaceae",
        "is_cover_crop": False,
        "is_legume": False,
        "ph_min": 5.5,
        "ph_max": 7.8,
        "max_salinity_dsm": 1.7,
        "gdd_required": 1320,
        "frost_free_days_min": 115,
        "min_rotation_break_years": 0,
        "water_demand_mm": 580,
        "n_balance_lbs_acre": -135.0,
        "n_credit_provided_lbs_acre": 0.0,
        "root_type": "fibrous",
        "seed_cost_per_acre": 118.0,
        "fertilizer_n_req_lbs_acre": 165.0,
        "base_irrigation_cost_per_acre": 68.0,
        "projected_yield_units_acre": 192.0,
        "yield_unit": "bu/ac",
        "regional_price_per_unit": 4.55,
        "erosion_protection_score": 52,
        "description": "High-calorie cereal grain with heavy nitrogen demand and fibrous root biomass.",
    },
    {
        "id": "soybeans",
        "name": "Soybeans / Pulses",
        "botanical_family": "Fabaceae",
        "is_cover_crop": False,
        "is_legume": True,
        "ph_min": 5.8,
        "ph_max": 7.6,
        "max_salinity_dsm": 5.0,
        "gdd_required": 1120,
        "frost_free_days_min": 105,
        "min_rotation_break_years": 1,
        "water_demand_mm": 460,
        "n_balance_lbs_acre": 32.0,
        "n_credit_provided_lbs_acre": 35.0,
        "root_type": "taproot",
        "seed_cost_per_acre": 76.0,
        "fertilizer_n_req_lbs_acre": 12.0,
        "base_irrigation_cost_per_acre": 45.0,
        "projected_yield_units_acre": 56.0,
        "yield_unit": "bu/ac",
        "regional_price_per_unit": 11.4,
        "erosion_protection_score": 58,
        "description": "Biological nitrogen-fixing legume providing +35 lbs/ac residual N credit.",
    },
    {
        "id": "winter_wheat",
        "name": "Winter Wheat / Barley",
        "botanical_family": "Poaceae",
        "is_cover_crop": False,
        "is_legume": False,
        "ph_min": 5.5,
        "ph_max": 8.2,
        "max_salinity_dsm": 6.0,
        "gdd_required": 940,
        "frost_free_days_min": 95,
        "min_rotation_break_years": 0,
        "water_demand_mm": 390,
        "n_balance_lbs_acre": -80.0,
        "n_credit_provided_lbs_acre": 0.0,
        "root_type": "fibrous",
        "seed_cost_per_acre": 48.0,
        "fertilizer_n_req_lbs_acre": 95.0,
        "base_irrigation_cost_per_acre": 24.0,
        "projected_yield_units_acre": 78.0,
        "yield_unit": "bu/ac",
        "regional_price_per_unit": 6.1,
        "erosion_protection_score": 84,
        "description": "Cool-season small grain delivering dense overwinter cover and salinity resilience.",
    },
    {
        "id": "canola",
        "name": "Canola / Mustard",
        "botanical_family": "Brassicaceae",
        "is_cover_crop": False,
        "is_legume": False,
        "ph_min": 5.8,
        "ph_max": 8.0,
        "max_salinity_dsm": 4.0,
        "gdd_required": 920,
        "frost_free_days_min": 90,
        "min_rotation_break_years": 2,
        "water_demand_mm": 370,
        "n_balance_lbs_acre": -85.0,
        "n_credit_provided_lbs_acre": 0.0,
        "root_type": "taproot",
        "seed_cost_per_acre": 68.0,
        "fertilizer_n_req_lbs_acre": 105.0,
        "base_irrigation_cost_per_acre": 28.0,
        "projected_yield_units_acre": 2150.0,
        "yield_unit": "lb/ac",
        "regional_price_per_unit": 0.28,
        "erosion_protection_score": 70,
        "description": "Deep-taproot Brassica oilseed; enforces clubroot rotation break.",
    },
    {
        "id": "sunflower_potato",
        "name": "Sunflower / Potato",
        "botanical_family": "Asteraceae/Solanaceae",
        "is_cover_crop": False,
        "is_legume": False,
        "ph_min": 5.4,
        "ph_max": 7.8,
        "max_salinity_dsm": 2.5,
        "gdd_required": 1060,
        "frost_free_days_min": 100,
        "min_rotation_break_years": 2,
        "water_demand_mm": 520,
        "n_balance_lbs_acre": -95.0,
        "n_credit_provided_lbs_acre": 0.0,
        "root_type": "tuber",
        "seed_cost_per_acre": 155.0,
        "fertilizer_n_req_lbs_acre": 115.0,
        "base_irrigation_cost_per_acre": 64.0,
        "projected_yield_units_acre": 2250.0,
        "yield_unit": "lb/ac",
        "regional_price_per_unit": 0.34,
        "erosion_protection_score": 48,
        "description": "High-value specialty crop group enforcing Verticillium wilt break.",
    },
    {
        "id": "alfalfa_clover",
        "name": "Alfalfa / Clover",
        "botanical_family": "Fabaceae (Perennial)",
        "is_cover_crop": False,
        "is_legume": True,
        "ph_min": 6.2,
        "ph_max": 8.1,
        "max_salinity_dsm": 2.2,
        "gdd_required": 860,
        "frost_free_days_min": 90,
        "min_rotation_break_years": 1,
        "water_demand_mm": 620,
        "n_balance_lbs_acre": 58.0,
        "n_credit_provided_lbs_acre": 45.0,
        "root_type": "deep_taproot",
        "seed_cost_per_acre": 62.0,
        "fertilizer_n_req_lbs_acre": 0.0,
        "base_irrigation_cost_per_acre": 72.0,
        "projected_yield_units_acre": 5.2,
        "yield_unit": "ton/ac",
        "regional_price_per_unit": 175.0,
        "erosion_protection_score": 94,
        "description": "Deep-rooted perennial forage legume delivering +45 lbs/ac N credit.",
    },
    {
        "id": "winter_cereal_rye",
        "name": "Winter Cereal Rye",
        "botanical_family": "Poaceae",
        "is_cover_crop": True,
        "is_legume": False,
        "ph_min": 4.8,
        "ph_max": 8.4,
        "max_salinity_dsm": 7.0,
        "gdd_required": 350,
        "frost_free_days_min": 45,
        "min_rotation_break_years": 0,
        "water_demand_mm": 180,
        "n_balance_lbs_acre": 10.0,
        "n_credit_provided_lbs_acre": 0.0,
        "root_type": "fibrous",
        "seed_cost_per_acre": 28.0,
        "fertilizer_n_req_lbs_acre": 0.0,
        "base_irrigation_cost_per_acre": 0.0,
        "projected_yield_units_acre": 0.0,
        "yield_unit": "cover",
        "regional_price_per_unit": 0.0,
        "erosion_protection_score": 98,
        "description": "Overwinter cover crop injected on sloped terrain (>5.0%) for erosion control.",
    },
    {
        "id": "crimson_clover",
        "name": "Crimson Clover",
        "botanical_family": "Fabaceae",
        "is_cover_crop": True,
        "is_legume": True,
        "ph_min": 5.5,
        "ph_max": 7.6,
        "max_salinity_dsm": 2.8,
        "gdd_required": 420,
        "frost_free_days_min": 60,
        "min_rotation_break_years": 0,
        "water_demand_mm": 210,
        "n_balance_lbs_acre": 45.0,
        "n_credit_provided_lbs_acre": 45.0,
        "root_type": "taproot",
        "seed_cost_per_acre": 34.0,
        "fertilizer_n_req_lbs_acre": 0.0,
        "base_irrigation_cost_per_acre": 0.0,
        "projected_yield_units_acre": 0.0,
        "yield_unit": "cover",
        "regional_price_per_unit": 0.0,
        "erosion_protection_score": 88,
        "description": "Overwinter nitrogen-fixing cover crop (+45 lbs N/acre credit).",
    },
]

COMPATIBILITY_MATRIX_SEED = {
    "corn": {"corn": 35, "soybeans": 95, "winter_wheat": 70, "canola": 80, "sunflower_potato": 75, "alfalfa_clover": 85},
    "soybeans": {"corn": 95, "soybeans": 30, "winter_wheat": 85, "canola": 75, "sunflower_potato": 65, "alfalfa_clover": 50},
    "winter_wheat": {"corn": 80, "soybeans": 85, "winter_wheat": 40, "canola": 90, "sunflower_potato": 80, "alfalfa_clover": 85},
    "canola": {"corn": 85, "soybeans": 70, "winter_wheat": 90, "canola": 20, "sunflower_potato": 60, "alfalfa_clover": 80},
    "sunflower_potato": {"corn": 80, "soybeans": 65, "winter_wheat": 85, "canola": 60, "sunflower_potato": 15, "alfalfa_clover": 85},
    "alfalfa_clover": {"corn": 98, "soybeans": 45, "winter_wheat": 80, "canola": 85, "sunflower_potato": 85, "alfalfa_clover": 25},
}


async def seed_database() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb"))
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        for crop_dict in CROP_SEED_DATA:
            existing = await session.get(Crop, crop_dict["id"])
            if existing:
                for k, v in crop_dict.items():
                    setattr(existing, k, v)
            else:
                session.add(Crop(**crop_dict))
        await session.flush()

        for prev_id, row in COMPATIBILITY_MATRIX_SEED.items():
            for next_id, score in row.items():
                stmt = select(TransitionMatrix).where(
                    TransitionMatrix.prev_crop_id == prev_id,
                    TransitionMatrix.next_crop_id == next_id,
                )
                existing_tm = (await session.execute(stmt)).scalar_one_or_none()
                if existing_tm:
                    existing_tm.baseline_score = score
                else:
                    session.add(
                        TransitionMatrix(
                            prev_crop_id=prev_id,
                            next_crop_id=next_id,
                            baseline_score=score,
                        )
                    )
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed_database())
