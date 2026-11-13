import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as turf from '@turf/turf';
import {
  ChevronDown,
  ChevronRight,
  PenTool,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { CropSpec, FieldRecord, GeoJsonPolygon, YieldRecord } from '../types';
import type { FieldSavePayload } from '../services/apiClient';

interface FieldFormModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  crops: CropSpec[];
  initialField?: FieldRecord | null;
  initialGeometry?: GeoJsonPolygon | null;
  initialSuggestedName?: string;
  defaultCenter?: [number, number];
  onClose: () => void;
  onRequestMapDraw?: () => void;
  onSubmit: (
    payload: FieldSavePayload,
    options: { runAnalysis: boolean; fieldId?: string }
  ) => Promise<void>;
}

interface YieldFormRow {
  id: string;
  year: number;
  value: string;
  unit: YieldRecord['unit'];
}

const HA_TO_ACRES = 2.47105381;
const SQ_METERS_PER_HA = 10000;

function createSquarePolygonForAreaHa(
  centerLat: number,
  centerLon: number,
  areaHa: number
): GeoJsonPolygon {
  const safeHa = Math.max(0.5, areaHa || 80.49);
  const sideMeters = Math.sqrt(safeHa * SQ_METERS_PER_HA);
  const halfMeters = sideMeters / 2;
  const latDelta = halfMeters / 111320;
  const lonDelta =
    halfMeters / (111320 * Math.max(0.2, Math.cos((centerLat * Math.PI) / 180)));

  const minLon = Number((centerLon - lonDelta).toFixed(6));
  const maxLon = Number((centerLon + lonDelta).toFixed(6));
  const minLat = Number((centerLat - latDelta).toFixed(6));
  const maxLat = Number((centerLat + latDelta).toFixed(6));

  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}

function computeAreaHa(geom: GeoJsonPolygon | null): number {
  if (!geom) return 0;
  try {
    const sqMeters = turf.area(turf.polygon(geom.coordinates));
    return Number((sqMeters / SQ_METERS_PER_HA).toFixed(2));
  } catch {
    return 0;
  }
}

export const FieldFormModal: React.FC<FieldFormModalProps> = ({
  isOpen,
  mode,
  crops,
  initialField,
  initialGeometry,
  initialSuggestedName,
  defaultCenter = [43.615, -116.202],
  onClose,
  onRequestMapDraw,
  onSubmit,
}) => {
  const cashCrops = useMemo(
    () => crops.filter((c) => !c.is_cover_crop),
    [crops]
  );

  const [name, setName] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [areaHaInput, setAreaHaInput] = useState('80.49');
  const [autoCalc, setAutoCalc] = useState(true);
  const [selectedCrop, setSelectedCrop] = useState('');
  const [notes, setNotes] = useState('');
  const [yields, setYields] = useState<YieldFormRow[]>([]);

  // Pre-analysis agronomic & soil details
  const [showSoilDetails, setShowSoilDetails] = useState(false);
  const [irrigated, setIrrigated] = useState(false);
  const [phInput, setPhInput] = useState('');
  const [omInput, setOmInput] = useState('');
  const [salinityInput, setSalinityInput] = useState('');
  const [slopeInput, setSlopeInput] = useState('');
  const [moistureInput, setMoistureInput] = useState('');
  const [textureInput, setTextureInput] = useState('');
  const [cecInput, setCecInput] = useState('');

  // GeoJSON preview & parcel coordinates
  const [showGeoJson, setShowGeoJson] = useState(false);
  const [geometry, setGeometry] = useState<GeoJsonPolygon | null>(null);
  const [geoJsonText, setGeoJsonText] = useState('');
  const [centerLatInput, setCenterLatInput] = useState(defaultCenter[0].toFixed(4));
  const [centerLonInput, setCenterLonInput] = useState(defaultCenter[1].toFixed(4));

  const [submittingMode, setSubmittingMode] = useState<'save' | 'analyze' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const geoFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setSubmittingMode(null);

    if (mode === 'edit' && initialField) {
      setName(initialField.name);
      setLocationLabel(initialField.location_label || '');
      const initialAuto = initialField.area_auto_calc !== false;
      setAutoCalc(initialAuto);
      const ha = Number((initialField.acreage / HA_TO_ACRES).toFixed(2));
      setAreaHaInput(String(ha));
      setSelectedCrop(initialField.previous_crops[0] || '');
      setNotes(initialField.notes || '');
      setYields(
        initialField.yields && initialField.yields.length > 0
          ? initialField.yields.map((y) => ({
              id: y.id,
              year: y.year,
              value: y.value === null || y.value === undefined ? '' : String(y.value),
              unit: y.unit,
            }))
          : [
              {
                id: `y-${Date.now().toString(36)}`,
                year: new Date().getUTCFullYear(),
                value: '',
                unit: 't/ha',
              },
            ]
      );
      setIrrigated(Boolean(initialField.soil.irrigated));
      setPhInput(String(initialField.soil.ph));
      setOmInput(String(initialField.soil.organic_matter_pct));
      setSalinityInput(String(initialField.soil.salinity_dsm));
      setSlopeInput(String(initialField.soil.mean_slope_pct));
      setMoistureInput(String(initialField.soil.smap_rootzone_moisture));
      setTextureInput(initialField.soil.soil_texture || '');
      setCecInput(String(initialField.soil.cec_meq));
      setShowSoilDetails(true);

      const geom = initialGeometry || initialField.geometry;
      setGeometry(geom);
      setGeoJsonText(JSON.stringify(geom, null, 2));
      setCenterLatInput(initialField.centroid_lat.toFixed(4));
      setCenterLonInput(initialField.centroid_lon.toFixed(4));
      setShowGeoJson(false);
    } else {
      const geom =
        initialGeometry ||
        createSquarePolygonForAreaHa(defaultCenter[0], defaultCenter[1], 80.49);
      const computedHa = computeAreaHa(geom);
      setName(initialSuggestedName || '');
      setLocationLabel('');
      setAutoCalc(true);
      setAreaHaInput((computedHa > 0 ? computedHa : 80.49).toFixed(2));
      setSelectedCrop('');
      setNotes('');
      setYields([
        {
          id: `y-${Date.now().toString(36)}`,
          year: new Date().getUTCFullYear(),
          value: '',
          unit: 't/ha',
        },
      ]);
      setIrrigated(false);
      setPhInput('');
      setOmInput('');
      setSalinityInput('');
      setSlopeInput('');
      setMoistureInput('');
      setTextureInput('');
      setCecInput('');
      setShowSoilDetails(false);

      setGeometry(geom);
      setGeoJsonText(JSON.stringify(geom, null, 2));
      try {
        const c = turf.centroid(turf.polygon(geom.coordinates));
        setCenterLatInput(c.geometry.coordinates[1].toFixed(4));
        setCenterLonInput(c.geometry.coordinates[0].toFixed(4));
      } catch {
        setCenterLatInput(defaultCenter[0].toFixed(4));
        setCenterLonInput(defaultCenter[1].toFixed(4));
      }
      setShowGeoJson(false);
    }
  }, [isOpen, mode, initialField, initialGeometry, initialSuggestedName]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const parsedAreaHa = Number(areaHaInput);
  const liveAcres =
    Number.isFinite(parsedAreaHa) && parsedAreaHa > 0
      ? parsedAreaHa * HA_TO_ACRES
      : 0;

  const handleToggleAutoCalc = (checked: boolean) => {
    setAutoCalc(checked);
    if (checked && geometry) {
      const ha = computeAreaHa(geometry);
      if (ha > 0) setAreaHaInput(ha.toFixed(2));
    }
  };

  const handleAddYieldRow = () => {
    const lastYear = yields.length > 0 ? yields[yields.length - 1].year - 1 : 2025;
    setYields((prev) => [
      ...prev,
      {
        id: `y-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        year: lastYear,
        value: '',
        unit: prev[0]?.unit || 't/ha',
      },
    ]);
  };

  const handleUpdateYieldRow = (
    id: string,
    patch: Partial<YieldFormRow>
  ) => {
    setYields((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  };

  const handleRemoveYieldRow = (id: string) => {
    setYields((prev) => prev.filter((row) => row.id !== id));
  };

  const handleApplyCenterCoords = () => {
    const lat = Number(centerLatInput);
    const lon = Number(centerLonInput);
    if (!Number.isFinite(lat) || lat < -85 || lat > 85) {
      setErrorMsg('Latitude must be between -85 and 85.');
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setErrorMsg('Longitude must be between -180 and 180.');
      return;
    }
    const targetHa = Number.isFinite(parsedAreaHa) && parsedAreaHa > 0 ? parsedAreaHa : 80.49;
    const nextGeom = createSquarePolygonForAreaHa(lat, lon, targetHa);
    setGeometry(nextGeom);
    setGeoJsonText(JSON.stringify(nextGeom, null, 2));
    if (autoCalc) {
      setAreaHaInput(computeAreaHa(nextGeom).toFixed(2));
    }
    setErrorMsg(null);
  };

  const handleGeoJsonTextChange = (nextText: string) => {
    setGeoJsonText(nextText);
    try {
      const parsed = JSON.parse(nextText) as {
        type?: string;
        coordinates?: number[][][];
        geometry?: GeoJsonPolygon;
        features?: Array<{ geometry?: GeoJsonPolygon }>;
      };
      let geom: GeoJsonPolygon | null = null;
      if (parsed.type === 'Polygon' && Array.isArray(parsed.coordinates)) {
        geom = { type: 'Polygon', coordinates: parsed.coordinates };
      } else if (parsed.type === 'Feature' && parsed.geometry?.type === 'Polygon') {
        geom = parsed.geometry;
      } else if (
        parsed.type === 'FeatureCollection' &&
        parsed.features?.[0]?.geometry?.type === 'Polygon'
      ) {
        geom = parsed.features[0].geometry;
      }
      if (geom && geom.coordinates[0]?.length >= 4) {
        setGeometry(geom);
        if (autoCalc) {
          const ha = computeAreaHa(geom);
          if (ha > 0) setAreaHaInput(ha.toFixed(2));
        }
        const c = turf.centroid(turf.polygon(geom.coordinates));
        setCenterLatInput(c.geometry.coordinates[1].toFixed(4));
        setCenterLonInput(c.geometry.coordinates[0].toFixed(4));
        setErrorMsg(null);
      }
    } catch {
      // Allow user to finish typing valid JSON
    }
  };

  const handleUploadGeoJsonFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        type: string;
        features?: Array<{ geometry?: GeoJsonPolygon; properties?: { name?: string } }>;
        geometry?: GeoJsonPolygon;
        coordinates?: number[][][];
        properties?: { name?: string };
      };

      let geom: GeoJsonPolygon | null = null;
      let uploadedName = '';

      if (parsed.type === 'FeatureCollection' && parsed.features?.[0]?.geometry) {
        geom = parsed.features[0].geometry;
        uploadedName = parsed.features[0].properties?.name || '';
      } else if (parsed.type === 'Feature' && parsed.geometry) {
        geom = parsed.geometry;
        uploadedName = parsed.properties?.name || '';
      } else if (parsed.type === 'Polygon' && parsed.coordinates) {
        geom = { type: 'Polygon', coordinates: parsed.coordinates };
      }

      if (!geom || geom.type !== 'Polygon' || !geom.coordinates?.[0] || geom.coordinates[0].length < 4) {
        throw new Error('GeoJSON must contain a valid Polygon geometry.');
      }

      setGeometry(geom);
      setGeoJsonText(JSON.stringify(geom, null, 2));
      if (uploadedName && !name.trim()) {
        setName(uploadedName);
      }
      if (autoCalc) {
        setAreaHaInput(computeAreaHa(geom).toFixed(2));
      }
      const c = turf.centroid(turf.polygon(geom.coordinates));
      setCenterLatInput(c.geometry.coordinates[1].toFixed(4));
      setCenterLonInput(c.geometry.coordinates[0].toFixed(4));
      setShowGeoJson(true);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to parse GeoJSON file.');
    } finally {
      e.target.value = '';
    }
  };

  const handleSubmit = async (runAnalysis: boolean) => {
    if (!name.trim()) {
      setErrorMsg('Enter a field name before saving.');
      return;
    }

    let finalGeometry = geometry;
    if (!finalGeometry || finalGeometry.coordinates[0]?.length < 4) {
      const lat = Number(centerLatInput) || defaultCenter[0];
      const lon = Number(centerLonInput) || defaultCenter[1];
      const targetHa = Number.isFinite(parsedAreaHa) && parsedAreaHa > 0 ? parsedAreaHa : 80.49;
      finalGeometry = createSquarePolygonForAreaHa(lat, lon, targetHa);
    }

    if (!autoCalc && (!Number.isFinite(parsedAreaHa) || parsedAreaHa <= 0)) {
      setErrorMsg('Enter a positive field area in hectares or enable Auto-calc.');
      return;
    }

    const cleanedYields: YieldRecord[] = yields
      .filter((y) => y.year && y.value.trim() !== '' && Number.isFinite(Number(y.value)))
      .map((y) => ({
        id: y.id,
        year: Number(y.year),
        value: Number(y.value),
        unit: y.unit,
      }));

    const priorCropId = selectedCrop || initialField?.previous_crops[0] || 'corn';
    const previousCrops =
      initialField && initialField.previous_crops.length > 1
        ? [priorCropId, ...initialField.previous_crops.slice(1)]
        : [priorCropId];

    const payload: FieldSavePayload = {
      name: name.trim(),
      location_label: locationLabel.trim() || undefined,
      geometry: finalGeometry,
      previous_crops: previousCrops,
      irrigated,
      area_auto_calc: autoCalc,
      area_ha: !autoCalc ? parsedAreaHa : undefined,
      notes: notes.trim(),
      yields: cleanedYields,
      analysis_status: runAnalysis ? 'analyzed' : 'pending',
    };

    const parseOptNum = (val: string) => {
      if (val.trim() === '') return undefined;
      const num = Number(val);
      return Number.isFinite(num) ? num : undefined;
    };

    const ph = parseOptNum(phInput);
    const om = parseOptNum(omInput);
    const sal = parseOptNum(salinityInput);
    const slope = parseOptNum(slopeInput);
    const moist = parseOptNum(moistureInput);
    const cec = parseOptNum(cecInput);

    if (ph !== undefined) payload.ph = ph;
    if (om !== undefined) payload.organic_matter_pct = om;
    if (sal !== undefined) payload.salinity_dsm = sal;
    if (slope !== undefined) payload.mean_slope_pct = slope;
    if (moist !== undefined) payload.smap_rootzone_moisture = moist;
    if (cec !== undefined) payload.cec_meq = cec;
    if (textureInput.trim()) payload.soil_texture = textureInput.trim();

    setSubmittingMode(runAnalysis ? 'analyze' : 'save');
    setErrorMsg(null);
    try {
      await onSubmit(payload, {
        runAnalysis,
        fieldId: initialField?.id,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save field.');
    } finally {
      setSubmittingMode(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1300] bg-slate-900/45 flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-md my-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-base font-bold text-slate-900">
            {mode === 'edit' ? 'Modify Field' : 'New Field'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
            aria-label="Close field dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-3.5 max-h-[82vh] overflow-y-auto">
          {errorMsg && (
            <div className="px-3 py-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md">
              {errorMsg}
            </div>
          )}

          {/* Field Name */}
          <div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Field name (e.g., Idaho Field)"
              autoFocus
              className="w-full px-3 py-2 text-sm text-slate-900 bg-white border-2 border-emerald-700/80 rounded-lg focus:outline-none focus:border-emerald-700"
            />
          </div>

          {/* Area (ha) + Auto-calc checkbox */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-[190px]">
              <input
                type="number"
                step="0.01"
                min="0.1"
                value={areaHaInput}
                readOnly={autoCalc}
                onChange={(e) => setAreaHaInput(e.target.value)}
                className={`w-full pl-3 pr-9 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                  autoCalc
                    ? 'bg-slate-50 text-slate-700'
                    : 'bg-white text-slate-900'
                }`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
                ha
              </span>
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoCalc}
                onChange={(e) => handleToggleAutoCalc(e.target.checked)}
                className="w-4 h-4 rounded accent-emerald-700 cursor-pointer"
              />
              Auto-calc
            </label>

            <span className="text-[11px] font-mono tabular-nums text-slate-400 ml-auto">
              {liveAcres.toFixed(1)} ac
            </span>
          </div>

          {/* Select crop... & optional location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <select
              value={selectedCrop}
              onChange={(e) => setSelectedCrop(e.target.value)}
              className="w-full px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="">Select crop...</option>
              {cashCrops.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={locationLabel}
              onChange={(e) => setLocationLabel(e.target.value)}
              placeholder="Region / County (optional)"
              className="w-full px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          {/* Notes */}
          <div>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
              className="w-full px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600 resize-y"
            />
          </div>

          {/* Yields (per year) */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">
                Yields (per year)
              </span>
              <button
                type="button"
                onClick={handleAddYieldRow}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                Add row
              </button>
            </div>

            {yields.length === 0 ? (
              <div className="text-xs text-slate-400 py-1">
                No historical yield rows added yet.
              </div>
            ) : (
              <div className="space-y-2">
                {yields.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-12 gap-2 items-center"
                  >
                    <input
                      type="number"
                      min="1980"
                      max="2100"
                      value={row.year}
                      onChange={(e) =>
                        handleUpdateYieldRow(row.id, {
                          year: Number(e.target.value) || new Date().getUTCFullYear(),
                        })
                      }
                      aria-label="Yield year"
                      className="col-span-3 px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Value"
                      value={row.value}
                      onChange={(e) =>
                        handleUpdateYieldRow(row.id, { value: e.target.value })
                      }
                      aria-label="Yield value"
                      className="col-span-4 px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <select
                      value={row.unit}
                      onChange={(e) =>
                        handleUpdateYieldRow(row.id, {
                          unit: e.target.value as YieldRecord['unit'],
                        })
                      }
                      aria-label="Yield unit"
                      className="col-span-3 px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    >
                      <option value="t/ha">t/ha</option>
                      <option value="bu/ac">bu/ac</option>
                      <option value="lb/ac">lb/ac</option>
                      <option value="ton/ac">ton/ac</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleRemoveYieldRow(row.id)}
                      className="col-span-2 flex items-center justify-center py-1.5 text-slate-400 hover:text-rose-600 border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                      aria-label="Delete yield row"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pre-Analysis Soil & Irrigation Overrides */}
          <div className="border-t border-slate-100 pt-2.5">
            <button
              type="button"
              onClick={() => setShowSoilDetails((v) => !v)}
              className="flex items-center justify-between w-full text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <span className="inline-flex items-center gap-1">
                {showSoilDetails ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                Pre-analysis soil & water details (optional)
              </span>
              <span className="text-[11px] text-slate-400">
                {irrigated ? 'Irrigated' : 'Dryland'}
              </span>
            </button>

            {showSoilDetails && (
              <div className="mt-2.5 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={irrigated}
                    onChange={(e) => setIrrigated(e.target.checked)}
                    className="accent-emerald-700"
                  />
                  Irrigated Parcel (enables high-water crops when dry)
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">
                      Soil pH
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="3.5"
                      max="9.5"
                      placeholder="Auto (USDA)"
                      value={phInput}
                      onChange={(e) => setPhInput(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">
                      Organic Matter (%)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="25"
                      placeholder="Auto (USDA)"
                      value={omInput}
                      onChange={(e) => setOmInput(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">
                      Salinity (dS/m)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="20"
                      placeholder="Auto (USDA)"
                      value={salinityInput}
                      onChange={(e) => setSalinityInput(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">
                      Mean Slope (%)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="45"
                      placeholder="Auto (DEM)"
                      value={slopeInput}
                      onChange={(e) => setSlopeInput(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">
                      SMAP Moisture (%)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      placeholder="Auto (SMAP)"
                      value={moistureInput}
                      onChange={(e) => setMoistureInput(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">
                      Soil Texture
                    </label>
                    <select
                      value={textureInput}
                      onChange={(e) => setTextureInput(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                    >
                      <option value="">Auto (USDA)</option>
                      <option value="Loam">Loam</option>
                      <option value="Silt Loam">Silt Loam</option>
                      <option value="Clay Loam">Clay Loam</option>
                      <option value="Silty Clay Loam">Silty Clay Loam</option>
                      <option value="Sandy Loam">Sandy Loam</option>
                      <option value="Loamy Sand">Loamy Sand</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* GeoJSON preview accordion */}
          <div className="border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => setShowGeoJson((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              {showGeoJson ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              GeoJSON preview
            </button>

            {showGeoJson && (
              <div className="mt-2 space-y-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={geoFileInputRef}
                    type="file"
                    accept=".geojson,.json"
                    onChange={handleUploadGeoJsonFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => geoFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                  >
                    <Upload className="w-3 h-3" />
                    Upload .geojson
                  </button>
                  {onRequestMapDraw && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onRequestMapDraw();
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                    >
                      <PenTool className="w-3 h-3" />
                      Draw on Map
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">
                      Center Lat
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={centerLatInput}
                      onChange={(e) => setCenterLatInput(e.target.value)}
                      className="w-full px-2 py-1 text-[11px] font-mono tabular-nums bg-white border border-slate-200 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">
                      Center Lon
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={centerLonInput}
                      onChange={(e) => setCenterLonInput(e.target.value)}
                      className="w-full px-2 py-1 text-[11px] font-mono tabular-nums bg-white border border-slate-200 rounded"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyCenterCoords}
                    className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                  >
                    Locate Box
                  </button>
                </div>

                <textarea
                  rows={5}
                  value={geoJsonText}
                  onChange={(e) => handleGeoJsonTextChange(e.target.value)}
                  className="w-full p-2 text-[11px] font-mono text-slate-700 bg-white border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submittingMode !== null}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={submittingMode !== null}
              className="px-3.5 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {submittingMode === 'save'
                ? 'Saving...'
                : mode === 'edit'
                  ? 'Save Details'
                  : 'Save Before Analyzing'}
            </button>
            <button
              type="button"
              onClick={() => handleSubmit(true)}
              disabled={submittingMode !== null}
              className="px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {submittingMode === 'analyze'
                ? 'Analyzing...'
                : mode === 'edit'
                  ? 'Save & Analyze'
                  : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
