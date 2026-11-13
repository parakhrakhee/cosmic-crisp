import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
import httpx
import redis.asyncio as aioredis
from app.core.config import get_settings

settings = get_settings()
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def snap_to_half_degree(coord: float) -> float:
    return round(coord * 2.0) / 2.0


def compute_hargreaves_et0(t_min_c: float, t_max_c: float, lat_deg: float, day_of_year: int) -> float:
    t_mean = (t_min_c + t_max_c) / 2.0
    dt = max(0.5, t_max_c - t_min_c)
    lat_rad = math.radians(lat_deg)
    dr = 1.0 + 0.033 * math.cos(2.0 * math.pi * day_of_year / 365.0)
    delta = 0.409 * math.sin(2.0 * math.pi * day_of_year / 365.0 - 1.39)
    cos_ws = max(-1.0, min(1.0, -math.tan(lat_rad) * math.tan(delta)))
    ws = math.acos(cos_ws)
    ra_mj = (24.0 * 60.0 / math.pi) * 0.0820 * dr * (
        ws * math.sin(lat_rad) * math.sin(delta)
        + math.cos(lat_rad) * math.cos(delta) * math.sin(ws)
    )
    ra_mm = max(1.5, ra_mj * 0.408)
    return max(0.3, 0.0023 * (t_mean + 17.8) * math.sqrt(dt) * ra_mm)


def _percentile(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, math.ceil((p / 100.0) * len(ordered)) - 1))
    return ordered[idx]


async def fetch_nasa_power_telemetry(lat: float, lon: float, elevation_m: int = 220) -> Dict[str, Any]:
    grid_lat = snap_to_half_degree(lat)
    grid_lon = snap_to_half_degree(lon)
    cache_key = f"nasa_power:{grid_lat:.1f}_{grid_lon:.1f}"

    redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        cached_raw = await redis_client.get(cache_key)
        if cached_raw:
            cached_obj = json.loads(cached_raw)
            cached_obj["cache_hit"] = True
            cached_obj["elevation_m"] = elevation_m or cached_obj.get("elevation_m", 220)
            return cached_obj
    except Exception:
        pass

    end_year = datetime.now(timezone.utc).year - 1
    start_year = end_year - 2
    params = {
        "parameters": "T2M_MIN,T2M_MAX,PRECTOTCORR",
        "community": "AG",
        "longitude": grid_lon,
        "latitude": grid_lat,
        "start": f"{start_year}0101",
        "end": f"{end_year}1231",
        "format": "JSON",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(settings.NASA_POWER_BASE_URL, params=params)
            resp.raise_for_status()
            payload = resp.json()

        p_data = payload["properties"]["parameter"]
        t_mins = p_data["T2M_MIN"]
        t_maxs = p_data["T2M_MAX"]
        precips = p_data["PRECTOTCORR"]
        et0_map = p_data.get("ET0", {})

        yearly_gdd: Dict[str, float] = {}
        yearly_precip: Dict[str, float] = {}
        yearly_grow_precip: Dict[str, float] = {}
        cur_streak: Dict[str, int] = {}
        max_streak: Dict[str, int] = {}
        monthly = [{"tmin": 0.0, "tmax": 0.0, "precip": 0.0, "et0": 0.0, "gdd": 0.0, "n": 0} for _ in range(12)]
        total_et0 = 0.0
        total_tmin = 0.0
        total_tmax = 0.0
        valid_days = 0
        used_direct_et0 = bool(et0_map)

        for dkey in sorted(t_mins.keys()):
            tmin = t_mins[dkey]
            tmax = t_maxs[dkey]
            precip = precips[dkey]
            if tmin <= -900 or tmax <= -900 or precip <= -900:
                continue

            yr = dkey[:4]
            mo = int(dkey[4:6]) - 1
            doy = datetime.strptime(dkey, "%Y%m%d").timetuple().tm_yday
            raw_et0 = et0_map.get(dkey)
            if raw_et0 is not None and raw_et0 > -900:
                et0_day = float(raw_et0)
            else:
                used_direct_et0 = False
                et0_day = compute_hargreaves_et0(tmin, tmax, grid_lat, doy)

            gdd_day = max(0.0, (max(10.0, min(30.0, tmin)) + max(10.0, min(30.0, tmax))) / 2.0 - 10.0)
            yearly_gdd[yr] = yearly_gdd.get(yr, 0.0) + gdd_day
            yearly_precip[yr] = yearly_precip.get(yr, 0.0) + max(0.0, precip)
            if 3 <= mo <= 9:
                yearly_grow_precip[yr] = yearly_grow_precip.get(yr, 0.0) + max(0.0, precip)

            if tmin > 0.0:
                cur_streak[yr] = cur_streak.get(yr, 0) + 1
                max_streak[yr] = max(max_streak.get(yr, 0), cur_streak[yr])
            else:
                cur_streak[yr] = 0

            b = monthly[mo]
            b["tmin"] += tmin
            b["tmax"] += tmax
            b["precip"] += max(0.0, precip)
            b["et0"] += et0_day
            b["gdd"] += gdd_day
            b["n"] += 1

            total_et0 += et0_day
            total_tmin += tmin
            total_tmax += tmax
            valid_days += 1

        if valid_days < 300:
            raise ValueError("Insufficient valid NASA POWER observations")

        years_cnt = max(1, len(yearly_gdd))
        now = datetime.now(timezone.utc)
        result = {
            "grid_lat": grid_lat,
            "grid_lon": grid_lon,
            "cache_key": f"{grid_lat:.1f}_{grid_lon:.1f}",
            "cache_hit": False,
            "cached_at": now.isoformat(),
            "expires_at": (now + timedelta(seconds=settings.NASA_CACHE_TTL_SECONDS)).isoformat(),
            "data_source": "NASA POWER API",
            "gdd_85th_percentile": round(_percentile(list(yearly_gdd.values()), 85)),
            "frost_free_days": round(sum(max_streak.get(y, 0) for y in yearly_gdd) / years_cnt),
            "annual_precip_mm": round(sum(yearly_precip.values()) / years_cnt),
            "growing_season_precip_mm": round(sum(yearly_grow_precip.values()) / years_cnt),
            "mean_et0_mm_day": round(total_et0 / valid_days, 2),
            "et0_method": "NASA POWER ET0" if used_direct_et0 else "FAO-56 Hargreaves Computed",
            "mean_t_min_c": round(total_tmin / valid_days, 1),
            "mean_t_max_c": round(total_tmax / valid_days, 1),
            "elevation_m": elevation_m,
            "monthly_series": [
                {
                    "month": MONTH_NAMES[idx],
                    "t_min_c": round(m["tmin"] / max(1, m["n"]), 1),
                    "t_max_c": round(m["tmax"] / max(1, m["n"]), 1),
                    "precip_mm": round(m["precip"] / years_cnt),
                    "et0_mm": round(m["et0"] / years_cnt),
                    "gdd_c": round(m["gdd"] / years_cnt),
                }
                for idx, m in enumerate(monthly)
            ],
        }
    except Exception:
        abs_lat = abs(grid_lat)
        elev_pen = max(0, elevation_m - 200) * 0.18
        now = datetime.now(timezone.utc)
        annual_p = round(480 if (abs_lat > 40 and grid_lon < -105) else (320 if (abs_lat < 38 and grid_lon < -115) else 840))
        result = {
            "grid_lat": grid_lat,
            "grid_lon": grid_lon,
            "cache_key": f"{grid_lat:.1f}_{grid_lon:.1f}",
            "cache_hit": False,
            "cached_at": now.isoformat(),
            "expires_at": (now + timedelta(seconds=settings.NASA_CACHE_TTL_SECONDS)).isoformat(),
            "data_source": "Climatology Fallback",
            "gdd_85th_percentile": max(620, round(2950 - abs_lat * 34 - elev_pen)),
            "frost_free_days": max(75, min(340, round(325 - abs_lat * 4.1 - elev_pen * 0.08))),
            "annual_precip_mm": annual_p,
            "growing_season_precip_mm": round(annual_p * (0.44 if grid_lon < -112 else 0.72)),
            "mean_et0_mm_day": 3.45,
            "et0_method": "FAO-56 Hargreaves Computed",
            "mean_t_min_c": 4.2,
            "mean_t_max_c": 16.4,
            "elevation_m": elevation_m,
            "monthly_series": [
                {
                    "month": MONTH_NAMES[idx],
                    "t_min_c": round(12 - abs_lat * 0.25 + 9 * math.sin((idx - 3) * math.pi / 6), 1),
                    "t_max_c": round(22 - abs_lat * 0.25 + 10 * math.sin((idx - 3) * math.pi / 6), 1),
                    "precip_mm": round(annual_p / 12),
                    "et0_mm": round(30 * compute_hargreaves_et0(4.0, 18.0, grid_lat, idx * 30 + 15)),
                    "gdd_c": 120,
                }
                for idx in range(12)
            ],
        }

    try:
        await redis_client.setex(cache_key, settings.NASA_CACHE_TTL_SECONDS, json.dumps(result))
    except Exception:
        pass
    finally:
        await redis_client.aclose()

    return result
