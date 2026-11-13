import { Router } from 'express';
import * as turf from '@turf/turf';
import { COMPATIBILITY_MATRIX, CROP_SPECS } from '../seedData';
import { fetchNasaPowerTelemetry } from '../services/nasaPower';
import { generateRotationPlans } from '../services/rotationEngine';
import { loadStore, saveStore } from '../services/store';
import { fetchUsdaSoilProfile } from '../services/usdaSoil';
import type { ActivityLogEntry, FieldRecord, GeoJsonPolygon } from '../types';

export const apiRouter = Router();

apiRouter.get('/health/live', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'cosmic-crisp-api',
    timestamp: new Date().toISOString(),
  });
});

apiRouter.get('/crops', (_req, res) => {
  res.json({
    crops: CROP_SPECS,
  });
});

apiRouter.get('/matrix', (_req, res) => {
  res.json({
    crops: CROP_SPECS.filter((c) => !c.is_cover_crop),
    cover_crops: CROP_SPECS.filter((c) => c.is_cover_crop),
    matrix: COMPATIBILITY_MATRIX,
  });
});

apiRouter.get('/fields', (_req, res) => {
  const store = loadStore();
  res.json({ fields: store.fields });
});

apiRouter.get('/fields/:id', (req, res) => {
  const store = loadStore();
  const field = store.fields.find((f) => f.id === req.params.id);
  if (!field) {
    res.status(404).json({ error: 'Field not found' });
    return;
  }
  res.json({ field });
});

apiRouter.post('/fields', async (req, res) => {
  try {
    const body = req.body as {
      name?: string;
      location_label?: string;
      geometry?: GeoJsonPolygon;
      previous_crops?: string[];
      irrigated?: boolean;
      mean_slope_pct?: number;
      smap_rootzone_moisture?: number;
    };

    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Field name is required' });
      return;
    }

    if (
      !body.geometry ||
      body.geometry.type !== 'Polygon' ||
      !Array.isArray(body.geometry.coordinates) ||
      body.geometry.coordinates[0]?.length < 4
    ) {
      res.status(400).json({ error: 'Valid GeoJSON Polygon with >= 4 ring coordinates is required' });
      return;
    }

    const feature = turf.polygon(body.geometry.coordinates);
    const cleaned = turf.cleanCoords(feature);
    const sqMeters = turf.area(cleaned);
    const acreage = Number((sqMeters * 0.000247105381).toFixed(2));
    const center = turf.centroid(cleaned);
    const [centroidLon, centroidLat] = center.geometry.coordinates;

    const { soil, elevationM } = await fetchUsdaSoilProfile(
      centroidLat,
      centroidLon,
      cleaned.geometry as GeoJsonPolygon
    );

    if (typeof body.irrigated === 'boolean') {
      soil.irrigated = body.irrigated;
    }
    if (typeof body.mean_slope_pct === 'number' && Number.isFinite(body.mean_slope_pct)) {
      soil.mean_slope_pct = Number(body.mean_slope_pct.toFixed(1));
    }
    if (typeof body.smap_rootzone_moisture === 'number' && Number.isFinite(body.smap_rootzone_moisture)) {
      soil.smap_rootzone_moisture = Math.max(0, Math.min(100, Math.round(body.smap_rootzone_moisture)));
    }

    const telemetry = await fetchNasaPowerTelemetry(centroidLat, centroidLon, elevationM);

    const now = new Date().toISOString();
    const newField: FieldRecord = {
      id: `field-${Date.now().toString(36)}`,
      name: body.name.trim(),
      location_label:
        body.location_label?.trim() ||
        `${centroidLat.toFixed(3)}°N, ${centroidLon.toFixed(3)}°E`,
      geometry: cleaned.geometry as GeoJsonPolygon,
      centroid_lat: Number(centroidLat.toFixed(5)),
      centroid_lon: Number(centroidLon.toFixed(5)),
      acreage,
      previous_crops:
        Array.isArray(body.previous_crops) && body.previous_crops.length > 0
          ? body.previous_crops
          : ['corn'],
      soil,
      telemetry,
      created_at: now,
      updated_at: now,
    };

    const store = loadStore();
    store.fields.unshift(newField);
    saveStore(store);

    res.status(201).json({ field: newField });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to create field',
    });
  }
});

apiRouter.put('/fields/:id/soil', (req, res) => {
  const store = loadStore();
  const idx = store.fields.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Field not found' });
    return;
  }

  const field = store.fields[idx];
  const body = req.body as Partial<{
    ph: number;
    organic_matter_pct: number;
    soil_texture: string;
    cec_meq: number;
    salinity_dsm: number;
    mean_slope_pct: number;
    smap_rootzone_moisture: number;
    irrigated: boolean;
    previous_crops: string[];
  }>;

  const updatedSoil = {
    ...field.soil,
    ...(typeof body.ph === 'number' ? { ph: Number(body.ph.toFixed(1)) } : {}),
    ...(typeof body.organic_matter_pct === 'number'
      ? { organic_matter_pct: Number(body.organic_matter_pct.toFixed(1)) }
      : {}),
    ...(typeof body.soil_texture === 'string' && body.soil_texture.trim()
      ? { soil_texture: body.soil_texture.trim() }
      : {}),
    ...(typeof body.cec_meq === 'number' ? { cec_meq: Number(body.cec_meq.toFixed(1)) } : {}),
    ...(typeof body.salinity_dsm === 'number'
      ? { salinity_dsm: Number(body.salinity_dsm.toFixed(2)) }
      : {}),
    ...(typeof body.mean_slope_pct === 'number'
      ? { mean_slope_pct: Number(body.mean_slope_pct.toFixed(1)) }
      : {}),
    ...(typeof body.smap_rootzone_moisture === 'number'
      ? { smap_rootzone_moisture: Math.max(0, Math.min(100, Math.round(body.smap_rootzone_moisture))) }
      : {}),
    ...(typeof body.irrigated === 'boolean' ? { irrigated: body.irrigated } : {}),
    source: 'Manual Lab Soil Test Override',
    is_manual_override: true,
    updated_at: new Date().toISOString(),
  };

  const updatedField: FieldRecord = {
    ...field,
    ...(Array.isArray(body.previous_crops) && body.previous_crops.length > 0
      ? { previous_crops: body.previous_crops }
      : {}),
    soil: updatedSoil,
    updated_at: new Date().toISOString(),
  };

  store.fields[idx] = updatedField;
  saveStore(store);
  res.json({ field: updatedField });
});

apiRouter.delete('/fields/:id', (req, res) => {
  const store = loadStore();
  const nextFields = store.fields.filter((f) => f.id !== req.params.id);
  if (nextFields.length === store.fields.length) {
    res.status(404).json({ error: 'Field not found' });
    return;
  }
  store.fields = nextFields;
  store.activities = store.activities.filter((a) => a.field_id !== req.params.id);
  saveStore(store);
  res.json({ deleted: true });
});

apiRouter.get('/telemetry', async (req, res) => {
  try {
    const fieldId = req.query.field_id as string | undefined;
    const store = loadStore();

    if (fieldId) {
      const idx = store.fields.findIndex((f) => f.id === fieldId);
      if (idx === -1) {
        res.status(404).json({ error: 'Field not found' });
        return;
      }
      const field = store.fields[idx];
      const telemetry = await fetchNasaPowerTelemetry(
        field.centroid_lat,
        field.centroid_lon,
        field.telemetry.elevation_m
      );
      store.fields[idx] = { ...field, telemetry, updated_at: new Date().toISOString() };
      saveStore(store);
      res.json({ telemetry });
      return;
    }

    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'Provide either field_id or valid lat & lon query params' });
      return;
    }
    const telemetry = await fetchNasaPowerTelemetry(lat, lon);
    res.json({ telemetry });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Telemetry lookup failed',
    });
  }
});

apiRouter.post('/rotations/generate', (req, res) => {
  try {
    const body = req.body as {
      field_id?: string;
      previous_crop_id?: string;
    };

    if (!body.field_id) {
      res.status(400).json({ error: 'field_id is required' });
      return;
    }

    const store = loadStore();
    const idx = store.fields.findIndex((f) => f.id === body.field_id);
    if (idx === -1) {
      res.status(404).json({ error: 'Field not found' });
      return;
    }

    const field = store.fields[idx];
    if (body.previous_crop_id && body.previous_crop_id !== field.previous_crops[0]) {
      field.previous_crops = [body.previous_crop_id, ...field.previous_crops.slice(1)];
      field.updated_at = new Date().toISOString();
      store.fields[idx] = field;
      saveStore(store);
    }

    const result = generateRotationPlans(field, body.previous_crop_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Rotation generation failed',
    });
  }
});

apiRouter.get('/activities', (req, res) => {
  const fieldId = req.query.field_id as string | undefined;
  const store = loadStore();
  const activities = fieldId
    ? store.activities.filter((a) => a.field_id === fieldId)
    : store.activities;
  res.json({ activities });
});

apiRouter.post('/activities', (req, res) => {
  const body = req.body as Partial<ActivityLogEntry>;
  if (!body.field_id || !body.activity_type || !body.crop_name || !body.date) {
    res.status(400).json({ error: 'field_id, activity_type, crop_name, and date are required' });
    return;
  }

  const store = loadStore();
  const entry: ActivityLogEntry = {
    id: body.id || `act-${Date.now().toString(36)}`,
    field_id: body.field_id,
    activity_type: body.activity_type,
    crop_name: body.crop_name,
    date: body.date,
    notes: body.notes?.trim() || '',
    n_applied_lbs_acre:
      typeof body.n_applied_lbs_acre === 'number' ? body.n_applied_lbs_acre : undefined,
    synced: true,
    created_at: body.created_at || new Date().toISOString(),
  };

  // Upsert by id to make offline sync idempotent
  const existingIdx = store.activities.findIndex((a) => a.id === entry.id);
  if (existingIdx >= 0) {
    store.activities[existingIdx] = entry;
  } else {
    store.activities.unshift(entry);
  }
  saveStore(store);

  res.status(201).json({ activity: entry });
});
