import type { ClimateTelemetry, MonthlyClimatePoint } from '../types';
import { getCachedNasaTelemetry, setCachedNasaTelemetry } from './store';

const NASA_POWER_URL =
  process.env.NASA_POWER_BASE_URL ||
  'https://power.larc.nasa.gov/api/temporal/daily/point';

export function snapToHalfDegreeGrid(coord: number): number {
  return Math.round(coord * 2) / 2;
}

/**
 * FAO-56 / Hargreaves reference evapotranspiration (mm/day)
 * ET0 = 0.0023 * (Tmean + 17.8) * sqrt(Tmax - Tmin) * Ra_mm
 * where Ra_mm is extraterrestrial radiation in water-equivalent mm/day.
 */
export function computeHargreavesEt0(
  tMinC: number,
  tMaxC: number,
  latDeg: number,
  dayOfYear: number
): number {
  const tMean = (tMinC + tMaxC) / 2;
  const dT = Math.max(0.5, tMaxC - tMinC);
  const latRad = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39);
  const cosWs = Math.max(-1, Math.min(1, -Math.tan(latRad) * Math.tan(delta)));
  const ws = Math.acos(cosWs);
  const raMj =
    ((24 * 60) / Math.PI) *
    0.082 *
    dr *
    (ws * Math.sin(latRad) * Math.sin(delta) +
      Math.cos(latRad) * Math.cos(delta) * Math.sin(ws));
  const raMm = Math.max(1.5, raMj * 0.408);
  return Math.max(0.3, 0.0023 * (tMean + 17.8) * Math.sqrt(dT) * raMm);
}

function dayOfYearFromYyyymmdd(yyyymmdd: string): number {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  const date = new Date(Date.UTC(y, m, d));
  const start = new Date(Date.UTC(y, 0, 0));
  return Math.floor((date.getTime() - start.getTime()) / 86400000);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export async function fetchNasaPowerTelemetry(
  lat: number,
  lon: number,
  elevationM = 220
): Promise<ClimateTelemetry> {
  const gridLat = snapToHalfDegreeGrid(lat);
  const gridLon = snapToHalfDegreeGrid(lon);
  const cacheKey = `${gridLat.toFixed(1)}_${gridLon.toFixed(1)}`;

  const cached = getCachedNasaTelemetry(cacheKey);
  if (cached) {
    return {
      ...cached,
      elevation_m: elevationM || cached.elevation_m,
    };
  }

  // Query 3 recent complete calendar years from NASA POWER Daily AG endpoint
  const endYear = new Date().getUTCFullYear() - 1;
  const startYear = endYear - 2;
  const startStr = `${startYear}0101`;
  const endStr = `${endYear}1231`;

  const url = `${NASA_POWER_URL}?parameters=T2M_MIN,T2M_MAX,PRECTOTCORR&community=AG&longitude=${gridLon}&latitude=${gridLat}&start=${startStr}&end=${endStr}&format=JSON`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`NASA POWER HTTP ${res.status}`);
    }

    const payload = (await res.json()) as {
      properties?: {
        parameter?: {
          T2M_MIN?: Record<string, number>;
          T2M_MAX?: Record<string, number>;
          PRECTOTCORR?: Record<string, number>;
          ET0?: Record<string, number>;
        };
      };
    };

    const params = payload.properties?.parameter;
    if (!params?.T2M_MIN || !params?.T2M_MAX || !params?.PRECTOTCORR) {
      throw new Error('NASA POWER payload missing daily parameters');
    }

    const dates = Object.keys(params.T2M_MIN).sort();
    const yearlyGdd: Record<string, number> = {};
    const yearlyFrostFree: Record<string, number> = {};
    const yearlyPrecip: Record<string, number> = {};
    const yearlyGrowingPrecip: Record<string, number> = {};
    const monthlyAgg: Array<{
      tMinSum: number;
      tMaxSum: number;
      precipSum: number;
      et0Sum: number;
      gddSum: number;
      count: number;
    }> = Array.from({ length: 12 }, () => ({
      tMinSum: 0,
      tMaxSum: 0,
      precipSum: 0,
      et0Sum: 0,
      gddSum: 0,
      count: 0,
    }));

    let currentStreakByYear: Record<string, number> = {};
    let maxStreakByYear: Record<string, number> = {};
    let totalEt0 = 0;
    let totalTmin = 0;
    let totalTmax = 0;
    let validDays = 0;
    let usedDirectEt0 = true;

    for (const dateKey of dates) {
      const tMin = params.T2M_MIN[dateKey];
      const tMax = params.T2M_MAX[dateKey];
      const precip = params.PRECTOTCORR[dateKey];
      const rawEt0 = params.ET0?.[dateKey];

      if (tMin <= -900 || tMax <= -900 || precip <= -900) continue;

      const year = dateKey.slice(0, 4);
      const monthIdx = Number(dateKey.slice(4, 6)) - 1;
      const doy = dayOfYearFromYyyymmdd(dateKey);

      let et0Day: number;
      if (rawEt0 !== undefined && rawEt0 !== null && rawEt0 > -900) {
        et0Day = rawEt0;
      } else {
        usedDirectEt0 = false;
        et0Day = computeHargreavesEt0(tMin, tMax, gridLat, doy);
      }

      // Base 10°C / Cap 30°C GDD
      const tMinAdj = Math.max(10, Math.min(30, tMin));
      const tMaxAdj = Math.max(10, Math.min(30, tMax));
      const dailyGdd = Math.max(0, (tMinAdj + tMaxAdj) / 2 - 10);

      yearlyGdd[year] = (yearlyGdd[year] || 0) + dailyGdd;
      yearlyPrecip[year] = (yearlyPrecip[year] || 0) + Math.max(0, precip);
      if (monthIdx >= 3 && monthIdx <= 9) {
        yearlyGrowingPrecip[year] = (yearlyGrowingPrecip[year] || 0) + Math.max(0, precip);
      }

      if (tMin > 0) {
        currentStreakByYear[year] = (currentStreakByYear[year] || 0) + 1;
        maxStreakByYear[year] = Math.max(maxStreakByYear[year] || 0, currentStreakByYear[year]);
      } else {
        currentStreakByYear[year] = 0;
      }

      const bucket = monthlyAgg[monthIdx];
      bucket.tMinSum += tMin;
      bucket.tMaxSum += tMax;
      bucket.precipSum += Math.max(0, precip);
      bucket.et0Sum += et0Day;
      bucket.gddSum += dailyGdd;
      bucket.count += 1;

      totalEt0 += et0Day;
      totalTmin += tMin;
      totalTmax += tMax;
      validDays += 1;
    }

    if (validDays < 300) {
      throw new Error('Insufficient valid NASA POWER daily observations');
    }

    const yearsCount = Math.max(1, Object.keys(yearlyGdd).length);
    const gddValues = Object.values(yearlyGdd);
    const frostValues = Object.keys(yearlyGdd).map((y) => maxStreakByYear[y] || 0);
    const precipValues = Object.values(yearlyPrecip);
    const growPrecipValues = Object.values(yearlyGrowingPrecip);

    const monthlySeries: MonthlyClimatePoint[] = monthlyAgg.map((m, idx) => ({
      month: MONTH_NAMES[idx],
      t_min_c: Number((m.tMinSum / Math.max(1, m.count)).toFixed(1)),
      t_max_c: Number((m.tMaxSum / Math.max(1, m.count)).toFixed(1)),
      precip_mm: Math.round(m.precipSum / yearsCount),
      et0_mm: Math.round(m.et0Sum / yearsCount),
      gdd_c: Math.round(m.gddSum / yearsCount),
    }));

    const now = new Date();
    const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const result: ClimateTelemetry = {
      grid_lat: gridLat,
      grid_lon: gridLon,
      cache_key: cacheKey,
      cache_hit: false,
      cached_at: now.toISOString(),
      expires_at: expires.toISOString(),
      data_source: 'NASA POWER API',
      gdd_85th_percentile: Math.round(percentile(gddValues, 85)),
      frost_free_days: Math.round(
        frostValues.reduce((sum, v) => sum + v, 0) / Math.max(1, frostValues.length)
      ),
      annual_precip_mm: Math.round(
        precipValues.reduce((sum, v) => sum + v, 0) / Math.max(1, precipValues.length)
      ),
      growing_season_precip_mm: Math.round(
        growPrecipValues.reduce((sum, v) => sum + v, 0) / Math.max(1, growPrecipValues.length)
      ),
      mean_et0_mm_day: Number((totalEt0 / validDays).toFixed(2)),
      et0_method: usedDirectEt0 ? 'NASA POWER ET0' : 'FAO-56 Hargreaves Computed',
      mean_t_min_c: Number((totalTmin / validDays).toFixed(1)),
      mean_t_max_c: Number((totalTmax / validDays).toFixed(1)),
      elevation_m: Math.round(elevationM),
      monthly_series: monthlySeries,
    };

    setCachedNasaTelemetry(cacheKey, result);
    return result;
  } catch {
    return buildClimatologyFallback(gridLat, gridLon, cacheKey, elevationM);
  }
}

function buildClimatologyFallback(
  gridLat: number,
  gridLon: number,
  cacheKey: string,
  elevationM: number
): ClimateTelemetry {
  const absLat = Math.abs(gridLat);
  const elevPenalty = Math.max(0, elevationM - 200) * 0.18;
  const gddEstimate = Math.max(620, Math.round(2950 - absLat * 34 - elevPenalty));
  const frostFreeEstimate = Math.max(75, Math.min(340, Math.round(325 - absLat * 4.1 - elevPenalty * 0.08)));
  const annualPrecip = Math.round(
    absLat > 40 && gridLon < -105 ? 480 : absLat < 38 && gridLon < -115 ? 320 : 840
  );
  const growPrecip = Math.round(annualPrecip * (gridLon < -112 ? 0.44 : 0.72));

  const isSouthernHemisphere = gridLat < 0;
  const monthlySeries: MonthlyClimatePoint[] = MONTH_NAMES.map((month, idx) => {
    const phase = isSouthernHemisphere ? ((idx + 6) % 12) : idx;
    const seasonal = Math.sin(((phase - 3) / 12) * Math.PI * 2);
    const baseTemp = 26 - absLat * 0.36;
    const tMax = Number((baseTemp + seasonal * 11 + 5).toFixed(1));
    const tMin = Number((baseTemp + seasonal * 11 - 6).toFixed(1));
    const precip = Math.round((annualPrecip / 12) * (1 + 0.35 * seasonal));
    const et0 = Math.round(computeHargreavesEt0(tMin, tMax, gridLat, idx * 30 + 15) * 30);
    const gdd = Math.round(Math.max(0, (Math.max(10, tMin) + Math.min(30, tMax)) / 2 - 10) * 30);
    return {
      month,
      t_min_c: tMin,
      t_max_c: tMax,
      precip_mm: Math.max(4, precip),
      et0_mm: et0,
      gdd_c: gdd,
    };
  });

  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const fallback: ClimateTelemetry = {
    grid_lat: gridLat,
    grid_lon: gridLon,
    cache_key: cacheKey,
    cache_hit: false,
    cached_at: now.toISOString(),
    expires_at: expires.toISOString(),
    data_source: 'Climatology Fallback',
    gdd_85th_percentile: gddEstimate,
    frost_free_days: frostFreeEstimate,
    annual_precip_mm: annualPrecip,
    growing_season_precip_mm: growPrecip,
    mean_et0_mm_day: Number((monthlySeries.reduce((s, m) => s + m.et0_mm, 0) / 365).toFixed(2)),
    et0_method: 'FAO-56 Hargreaves Computed',
    mean_t_min_c: Number((monthlySeries.reduce((s, m) => s + m.t_min_c, 0) / 12).toFixed(1)),
    mean_t_max_c: Number((monthlySeries.reduce((s, m) => s + m.t_max_c, 0) / 12).toFixed(1)),
    elevation_m: Math.round(elevationM),
    monthly_series: monthlySeries,
  };

  setCachedNasaTelemetry(cacheKey, fallback);
  return fallback;
}
