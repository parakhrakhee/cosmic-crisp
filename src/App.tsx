import { useEffect, useState } from 'react';
import { Trash2, Play } from 'lucide-react';
import { FieldMap } from './components/FieldMap';
import {
  ActivityLogView,
  ClimateTelemetryView,
  CompatibilityMatrixView,
} from './components/MatrixAndTelemetryViews';
import { RotationCards } from './components/RotationCards';
import { SoilAuditCard } from './components/SoilAuditCard';
import {
  createField,
  deleteField,
  fetchActivities,
  fetchFields,
  fetchMatrixAndCrops,
  generateRotations,
  logActivity,
  refreshFieldTelemetry,
  syncPendingActivities,
  updateFieldSoil,
} from './services/apiClient';
import type {
  ActivityLogEntry,
  CropSpec,
  FieldRecord,
  GeoJsonPolygon,
  RotationGenerationResponse,
} from './types';

type ActiveTab = 'planner' | 'matrix' | 'telemetry' | 'activities';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('planner');
  const [fields, setFields] = useState<FieldRecord[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  const [crops, setCrops] = useState<CropSpec[]>([]);
  const [coverCrops, setCoverCrops] = useState<CropSpec[]>([]);
  const [matrix, setMatrix] = useState<Record<string, Record<string, number>>>({});
  const [rotationData, setRotationData] = useState<RotationGenerationResponse | null>(null);
  const [activities, setActivities] = useState<ActivityLogEntry[]>([]);

  const [loadingFields, setLoadingFields] = useState(true);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [refreshingTelemetry, setRefreshingTelemetry] = useState(false);
  const [fromOfflineCache, setFromOfflineCache] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [drawSignal, setDrawSignal] = useState(0);

  const selectedField = fields.find((f) => f.id === selectedFieldId) || fields[0] || null;

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const [fieldRes, matrixRes] = await Promise.all([
          fetchFields(),
          fetchMatrixAndCrops(),
        ]);
        if (cancelled) return;
        setFields(fieldRes.fields);
        setFromOfflineCache(fieldRes.fromOfflineCache);
        setCrops(matrixRes.crops);
        setCoverCrops(matrixRes.cover_crops);
        setMatrix(matrixRes.matrix);

        if (fieldRes.fields[0]) {
          setSelectedFieldId(fieldRes.fields[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorBanner(
            err instanceof Error ? err.message : 'Unable to load Cosmic Crisp workspace.'
          );
        }
      } finally {
        if (!cancelled) setLoadingFields(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // Automatically compute rotation plan & load activity log whenever selected field changes
  useEffect(() => {
    if (!selectedField) return;
    let cancelled = false;

    async function loadFieldDetails() {
      if (!selectedField) return;
      setGeneratingPlan(true);
      setErrorBanner(null);
      try {
        const [rotRes, actRes] = await Promise.all([
          generateRotations(selectedField.id, selectedField.previous_crops[0]),
          fetchActivities(selectedField.id),
        ]);
        if (cancelled) return;
        setRotationData(rotRes.result);
        setFromOfflineCache(rotRes.fromOfflineCache);
        setActivities(actRes);
      } catch (err) {
        if (!cancelled) {
          setErrorBanner(err instanceof Error ? err.message : 'Failed to run optimization');
        }
      } finally {
        if (!cancelled) setGeneratingPlan(false);
      }
    }

    loadFieldDetails();
    return () => {
      cancelled = true;
    };
  }, [selectedField?.id]);

  const handleCreateField = async (payload: {
    name: string;
    location_label?: string;
    geometry: GeoJsonPolygon;
    previous_crops: string[];
    irrigated: boolean;
  }) => {
    const created = await createField(payload);
    setFields((prev) => [created, ...prev]);
    setSelectedFieldId(created.id);
    setActiveTab('planner');
  };

  const handleSaveSoilOverride = async (
    fieldId: string,
    payload: {
      ph: number;
      organic_matter_pct: number;
      soil_texture: string;
      cec_meq: number;
      salinity_dsm: number;
      mean_slope_pct: number;
      smap_rootzone_moisture: number;
      irrigated: boolean;
    }
  ) => {
    const updated = await updateFieldSoil(fieldId, payload);
    setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    setGeneratingPlan(true);
    try {
      const rotRes = await generateRotations(updated.id, updated.previous_crops[0]);
      setRotationData(rotRes.result);
      setFromOfflineCache(rotRes.fromOfflineCache);
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handlePreviousCropChange = async (prevCropId: string) => {
    if (!selectedField) return;
    setGeneratingPlan(true);
    try {
      const rotRes = await generateRotations(selectedField.id, prevCropId);
      setRotationData(rotRes.result);
      setFields((prev) =>
        prev.map((f) =>
          f.id === selectedField.id
            ? { ...f, previous_crops: [prevCropId, ...f.previous_crops.slice(1)] }
            : f
        )
      );
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleDeleteField = async (fieldId: string) => {
    await deleteField(fieldId);
    const remaining = fields.filter((f) => f.id !== fieldId);
    setFields(remaining);
    if (selectedFieldId === fieldId) {
      setSelectedFieldId(remaining[0]?.id || '');
    }
  };

  const handleRefreshTelemetry = async (fieldId: string) => {
    setRefreshingTelemetry(true);
    try {
      const telemetry = await refreshFieldTelemetry(fieldId);
      setFields((prev) =>
        prev.map((f) => (f.id === fieldId ? { ...f, telemetry } : f))
      );
      const rotRes = await generateRotations(fieldId);
      setRotationData(rotRes.result);
    } finally {
      setRefreshingTelemetry(false);
    }
  };

  const handleLogActivity = async (
    entry: Omit<ActivityLogEntry, 'id' | 'synced' | 'created_at'>
  ) => {
    await logActivity(entry);
    if (selectedField) {
      const updated = await fetchActivities(selectedField.id);
      setActivities(updated);
    }
  };

  const handleSyncPending = async () => {
    if (!selectedField) return;
    await syncPendingActivities(selectedField.id);
    const updated = await fetchActivities(selectedField.id);
    setActivities(updated);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col">
      {/* Top Bar Contract: 1 Row, 3 Zones separated by gap-8 */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8 sticky top-0 z-[1000]">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('planner');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          Cosmic Crisp
        </a>

        {/* Zone 2: 4 clean single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('planner')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'planner'
                ? 'border-emerald-700 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Field Planner
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('matrix')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'matrix'
                ? 'border-emerald-700 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Compatibility Matrix
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('telemetry')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'telemetry'
                ? 'border-emerald-700 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Climate Telemetry
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('activities')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'activities'
                ? 'border-emerald-700 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Activity Log
          </button>
        </nav>

        {/* Zone 3: 1 Primary CTA button */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('planner');
              setDrawSignal((s) => s + 1);
            }}
            className="px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Draw New Field
          </button>
        </div>
      </header>

      {/* Mobile Tab Bar */}
      <div className="md:hidden flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-200 overflow-x-auto">
        {(
          [
            ['planner', 'Field Planner'],
            ['matrix', 'Compatibility Matrix'],
            ['telemetry', 'Climate Telemetry'],
            ['activities', 'Activity Log'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              activeTab === key
                ? 'bg-emerald-50 text-emerald-800'
                : 'text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {errorBanner && (
        <div className="bg-rose-50 border-b border-rose-200 px-6 py-2.5 text-xs text-rose-800">
          {errorBanner}
        </div>
      )}

      {/* Main Split Workspace */}
      <div className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Field Inventory & Engine Controls Column */}
        <aside className="lg:col-span-3 space-y-5">
          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70">
              <h1 className="text-sm font-semibold text-slate-900">
                Registered Field Parcels
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {fields.length} parcels · Select to inspect & optimize
              </p>
            </div>

            {loadingFields ? (
              <div className="p-4 space-y-2">
                <div className="h-12 bg-slate-100 rounded animate-pulse" />
                <div className="h-12 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {fields.map((f) => {
                  const isSelected = selectedField?.id === f.id;
                  return (
                    <div
                      key={f.id}
                      className={`p-3.5 transition-colors ${
                        isSelected ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedFieldId(f.id)}
                          className="text-left flex-1 cursor-pointer"
                        >
                          <div className="text-sm font-semibold text-slate-900 leading-snug">
                            {f.name}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {f.location_label}
                          </div>
                          <div className="text-xs font-mono tabular-nums text-slate-600 mt-1">
                            {f.acreage.toFixed(1)} ac · pH {f.soil.ph.toFixed(1)} · Slope{' '}
                            {f.soil.mean_slope_pct.toFixed(1)}%
                          </div>
                        </button>

                        {fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleDeleteField(f.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                            title="Delete parcel"
                            aria-label={`Delete ${f.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {selectedField && (
            <section className="border border-slate-200 bg-white rounded-lg p-4 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  4-Stage Engine Parameters
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure prior harvest to run Beam Search (width = 5)
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prior Season Crop
                </label>
                <select
                  value={selectedField.previous_crops[0] || 'corn'}
                  onChange={(e) => handlePreviousCropChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  {crops.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() =>
                  handlePreviousCropChange(selectedField.previous_crops[0] || 'corn')
                }
                disabled={generatingPlan}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                {generatingPlan ? 'Optimizing 3-Year Plan...' : 'Re-Run 4-Stage Optimizer'}
              </button>
            </section>
          )}
        </aside>

        {/* Main Analytical Stage */}
        <main className="lg:col-span-9 space-y-6">
          {/* 4-Column Top KPI Strip */}
          {selectedField && (
            <section className="grid grid-cols-2 md:grid-cols-4 border border-slate-200 bg-white rounded-lg divide-y md:divide-y-0 md:divide-x divide-slate-200">
              <div className="p-4">
                <div className="text-xs text-slate-500">Parcel Area</div>
                <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
                  {selectedField.acreage.toFixed(1)}
                  <span className="text-xs font-normal text-slate-400 ml-1.5">acres</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">
                  {selectedField.location_label}
                </div>
              </div>

              <div className="p-4">
                <div className="text-xs text-slate-500">85th-Pct GDD (Base 10°C)</div>
                <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
                  {selectedField.telemetry.gdd_85th_percentile}
                  <span className="text-xs font-normal text-slate-400 ml-1.5">°C·d</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Grid {selectedField.telemetry.grid_lat.toFixed(1)}°,{' '}
                  {selectedField.telemetry.grid_lon.toFixed(1)}°
                </div>
              </div>

              <div className="p-4">
                <div className="text-xs text-slate-500">Frost-Free Window</div>
                <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
                  {selectedField.telemetry.frost_free_days}
                  <span className="text-xs font-normal text-slate-400 ml-1.5">days</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Growing Precip {selectedField.telemetry.growing_season_precip_mm} mm
                </div>
              </div>

              <div className="p-4">
                <div className="text-xs text-slate-500">Top Plan Composite Score</div>
                <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
                  {rotationData?.ranked_plans[0]
                    ? rotationData.ranked_plans[0].composite_3yr_score.toFixed(1)
                    : '—'}
                  <span className="text-xs font-normal text-slate-400 ml-1.5">/100</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {rotationData?.ranked_plans[0]
                    ? `$${rotationData.ranked_plans[0].cumulative_3yr_net_margin_usd_acre.toFixed(0)}/ac 3-yr net`
                    : 'Run optimizer'}
                </div>
              </div>
            </section>
          )}

          {activeTab === 'planner' && (
            <>
              <FieldMap
                fields={fields}
                selectedField={selectedField}
                crops={[...crops, ...coverCrops]}
                onSelectField={setSelectedFieldId}
                onCreateField={handleCreateField}
                externalStartDrawSignal={drawSignal}
              />

              {selectedField && (
                <SoilAuditCard
                  field={selectedField}
                  onSaveOverride={handleSaveSoilOverride}
                />
              )}

              <RotationCards
                rotationData={rotationData}
                loading={generatingPlan}
                fromOfflineCache={fromOfflineCache}
              />
            </>
          )}

          {activeTab === 'matrix' && (
            <CompatibilityMatrixView
              crops={crops}
              coverCrops={coverCrops}
              matrix={matrix}
            />
          )}

          {activeTab === 'telemetry' && selectedField && (
            <ClimateTelemetryView
              field={selectedField}
              onRefreshTelemetry={handleRefreshTelemetry}
              refreshing={refreshingTelemetry}
            />
          )}

          {activeTab === 'activities' && selectedField && (
            <ActivityLogView
              field={selectedField}
              crops={[...crops, ...coverCrops]}
              activities={activities}
              onLogActivity={handleLogActivity}
              onSyncPending={handleSyncPending}
            />
          )}
        </main>
      </div>
    </div>
  );
}
