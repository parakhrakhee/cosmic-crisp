'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { CheckCircle2, CloudOff, Play, Plus, RefreshCw } from 'lucide-react';
import {
  PRIMARY_CROPS,
  createActivity,
  createField,
  generateRotations,
  listActivities,
  listFields,
  overrideFieldSoil,
  syncQueuedActivities,
  type ActivityRecord,
  type FieldCreateRequest,
  type FieldResponseDTO,
  type RotationGenerateResponse,
  type SoilOverrideRequest,
} from '@/lib/api';
import { SoilAuditCard } from '@/components/SoilAuditCard';
import { RotationCards } from '@/components/RotationCards';

const FieldMap = dynamic(
  () => import('@/components/FieldMap').then((mod) => mod.FieldMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[430px] border border-slate-200 bg-white rounded-lg flex items-center justify-center text-xs text-slate-500">
        Initializing Leaflet geospatial canvas...
      </div>
    ),
  }
);

export default function CosmicCrispDashboardPage() {
  const [fields, setFields] = useState<FieldResponseDTO[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  const [rotationData, setRotationData] = useState<RotationGenerateResponse | null>(null);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);

  const [loadingFields, setLoadingFields] = useState(true);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Activity logger form state
  const [activityType, setActivityType] = useState('Planting');
  const [activityCrop, setActivityCrop] = useState<string>(PRIMARY_CROPS[0].name);
  const [activityDate, setActivityDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activityNRate, setActivityNRate] = useState('');
  const [activityNotes, setActivityNotes] = useState('');
  const [loggingActivity, setLoggingActivity] = useState(false);

  const selectedField = fields.find((f) => f.id === selectedFieldId) || fields[0] || null;

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const res = await listFields();
        if (!active) return;
        setFields(res.fields);
        setOfflineMode(res.offline);
        if (res.fields[0]) {
          setSelectedFieldId(res.fields[0].id);
        }
      } catch (err) {
        if (active) {
          setErrorBanner(err instanceof Error ? err.message : 'Unable to load fields.');
        }
      } finally {
        if (active) setLoadingFields(false);
      }
    }
    bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedField) return;
    let active = true;

    async function loadFieldWorkspace() {
      if (!selectedField) return;
      setGeneratingPlan(true);
      setErrorBanner(null);
      try {
        const [rotRes, actRes] = await Promise.all([
          generateRotations({
            field_id: selectedField.id,
            previous_crop_id: selectedField.previous_crops[0],
          }),
          listActivities(selectedField.id),
        ]);
        if (!active) return;
        setRotationData(rotRes.result);
        setActivities(actRes.activities);
        setOfflineMode(rotRes.offline || actRes.offline);
      } catch (err) {
        if (active) {
          setErrorBanner(err instanceof Error ? err.message : 'Failed to generate rotation plans.');
        }
      } finally {
        if (active) setGeneratingPlan(false);
      }
    }

    loadFieldWorkspace();
    return () => {
      active = false;
    };
  }, [selectedField?.id]);

  const handleCreateField = async (payload: FieldCreateRequest) => {
    const created = await createField(payload);
    setFields((prev) => [created, ...prev]);
    setSelectedFieldId(created.id);
    setOfflineMode(false);
  };

  const handleSaveSoilOverride = async (fieldId: string, payload: SoilOverrideRequest) => {
    const updated = await overrideFieldSoil(fieldId, payload);
    setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    setGeneratingPlan(true);
    try {
      const rotRes = await generateRotations({
        field_id: updated.id,
        previous_crop_id: updated.previous_crops[0],
      });
      setRotationData(rotRes.result);
      setOfflineMode(rotRes.offline);
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleRegenerateWithPriorCrop = async (prevCropId: string) => {
    if (!selectedField) return;
    setGeneratingPlan(true);
    setErrorBanner(null);
    try {
      const rotRes = await generateRotations({
        field_id: selectedField.id,
        previous_crop_id: prevCropId,
      });
      setRotationData(rotRes.result);
      setOfflineMode(rotRes.offline);
      setFields((prev) =>
        prev.map((f) =>
          f.id === selectedField.id
            ? { ...f, previous_crops: [prevCropId, ...f.previous_crops.slice(1)] }
            : f
        )
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Rotation generation failed.');
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleLogActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedField) return;
    setLoggingActivity(true);
    try {
      await createActivity({
        field_id: selectedField.id,
        activity_type: activityType,
        crop_name: activityCrop,
        date: activityDate,
        notes: activityNotes.trim(),
        n_applied_lbs_acre: activityNRate ? Number(activityNRate) : undefined,
      });
      const updated = await listActivities(selectedField.id);
      setActivities(updated.activities);
      setOfflineMode(updated.offline);
      setActivityNotes('');
      setActivityNRate('');
    } finally {
      setLoggingActivity(false);
    }
  };

  const handleSyncOfflineQueue = async () => {
    if (!selectedField) return;
    await syncQueuedActivities(selectedField.id);
    const updated = await listActivities(selectedField.id);
    setActivities(updated.activities);
    setOfflineMode(updated.offline);
  };

  const pendingSyncCount = activities.filter((a) => !a.synced).length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-8 sticky top-0 z-30">
        <span className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
          Cosmic Crisp
        </span>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a href="#map-section" className="hover:text-slate-900 whitespace-nowrap shrink-0">
            Field Map
          </a>
          <a href="#soil-section" className="hover:text-slate-900 whitespace-nowrap shrink-0">
            Soil & Climate
          </a>
          <a href="#rotations-section" className="hover:text-slate-900 whitespace-nowrap shrink-0">
            Rotation Plans
          </a>
          <a href="#activity-section" className="hover:text-slate-900 whitespace-nowrap shrink-0">
            Activity Log
          </a>
        </nav>
        <div className="text-xs font-mono text-slate-500 whitespace-nowrap shrink-0">
          {offlineMode ? 'Offline IndexedDB Cache' : 'FastAPI Synced'}
        </div>
      </header>

      {errorBanner && (
        <div className="bg-rose-50 border-b border-rose-200 px-6 py-2.5 text-xs text-rose-800">
          {errorBanner}
        </div>
      )}

      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Sidebar: Field Inventory & Rotation Trigger */}
        <aside className="lg:col-span-3 space-y-5">
          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70">
              <h1 className="text-sm font-semibold text-slate-900">Field Parcels</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {fields.length} registered · Cached in IndexedDB
              </p>
            </div>

            {loadingFields ? (
              <div className="p-4 space-y-2">
                <div className="h-12 bg-slate-100 rounded animate-pulse" />
                <div className="h-12 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : fields.length === 0 ? (
              <div className="p-4 text-xs text-slate-500">
                Draw a polygon or upload GeoJSON on the map to register your first field parcel.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {fields.map((f) => {
                  const active = selectedField?.id === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedFieldId(f.id)}
                      className={`w-full text-left p-3.5 transition-colors ${
                        active ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-sm font-semibold text-slate-900">{f.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{f.location_label}</div>
                      <div className="text-xs font-mono tabular-nums text-slate-600 mt-1">
                        {f.acreage.toFixed(1)} ac · pH {f.soil.ph.toFixed(1)} · Slope{' '}
                        {f.soil.mean_slope_pct.toFixed(1)}%
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {selectedField && (
            <section className="border border-slate-200 bg-white rounded-lg p-4 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">4-Stage Engine</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure prior crop & run 3-year Beam Search
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prior Season Crop
                </label>
                <select
                  value={selectedField.previous_crops[0] || 'corn'}
                  onChange={(e) => handleRegenerateWithPriorCrop(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                >
                  {PRIMARY_CROPS.map((crop) => (
                    <option key={crop.id} value={crop.id}>
                      {crop.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() =>
                  handleRegenerateWithPriorCrop(selectedField.previous_crops[0] || 'corn')
                }
                disabled={generatingPlan}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                {generatingPlan ? 'Optimizing...' : 'Generate 3-Year Plan'}
              </button>
            </section>
          )}
        </aside>

        {/* Main Analytical Workspace */}
        <main className="lg:col-span-9 space-y-6">
          <div id="map-section">
            <FieldMap
              fields={fields}
              selectedField={selectedField}
              onSelectField={setSelectedFieldId}
              onCreateField={handleCreateField}
            />
          </div>

          {selectedField && (
            <div id="soil-section">
              <SoilAuditCard field={selectedField} onSaveOverride={handleSaveSoilOverride} />
            </div>
          )}

          <div id="rotations-section">
            <RotationCards data={rotationData} loading={generatingPlan} offline={offlineMode} />
          </div>

          {/* Offline Activity Logger */}
          {selectedField && (
            <section
              id="activity-section"
              className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start"
            >
              <form
                onSubmit={handleLogActivity}
                className="border border-slate-200 bg-white rounded-lg p-5 space-y-3"
              >
                <h2 className="text-sm font-semibold text-slate-900">Offline Activity Logger</h2>
                <p className="text-xs text-slate-500">
                  Saves immediately to Dexie.js IndexedDB and syncs to /api/v1/activities.
                </p>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Operation
                  </label>
                  <select
                    value={activityType}
                    onChange={(e) => setActivityType(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <option value="Planting">Planting</option>
                    <option value="Soil Sample">Soil Sample</option>
                    <option value="Cover Crop Termination">Cover Crop Termination</option>
                    <option value="Fertilizer Application">Fertilizer Application</option>
                    <option value="Irrigation">Irrigation</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Crop</label>
                  <select
                    value={activityCrop}
                    onChange={(e) => setActivityCrop(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    {PRIMARY_CROPS.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                    <option value="Winter Cereal Rye">Winter Cereal Rye</option>
                    <option value="Crimson Clover">Crimson Clover</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                    <input
                      type="date"
                      required
                      value={activityDate}
                      onChange={(e) => setActivityDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      N Rate (lbs/ac)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={activityNRate}
                      onChange={(e) => setActivityNRate(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                  <textarea
                    rows={2}
                    value={activityNotes}
                    onChange={(e) => setActivityNotes(e.target.value)}
                    placeholder="Stand count, soil moisture, residue..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loggingActivity}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {loggingActivity ? 'Saving...' : 'Log Field Activity'}
                </button>
              </form>

              <div className="md:col-span-2 border border-slate-200 bg-white rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Activity History — {selectedField.name}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {activities.length} operations · {pendingSyncCount} queued offline
                    </p>
                  </div>
                  {pendingSyncCount > 0 && (
                    <button
                      type="button"
                      onClick={handleSyncOfflineQueue}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-300 rounded-md hover:bg-amber-100"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Sync Queue ({pendingSyncCount})
                    </button>
                  )}
                </div>

                {activities.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No activity logs recorded for this field yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {activities.map((act) => (
                      <div key={act.id} className="p-4 flex items-start justify-between gap-4">
                        <div>
                          <div className="text-xs text-slate-500">
                            <span className="font-mono font-medium text-slate-700">{act.date}</span> ·{' '}
                            <span className="font-medium text-slate-800">{act.activity_type}</span> ·{' '}
                            <span>{act.crop_name}</span>
                            {act.n_applied_lbs_acre !== null &&
                              act.n_applied_lbs_acre !== undefined && (
                                <span className="font-mono"> · {act.n_applied_lbs_acre} lbs N/ac</span>
                              )}
                          </div>
                          {act.notes && (
                            <p className="mt-1 text-sm text-slate-700">{act.notes}</p>
                          )}
                        </div>
                        <span className="text-xs shrink-0">
                          {act.synced ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Synced
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <CloudOff className="w-3.5 h-3.5" /> Queued
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
