import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Database, LogIn, LogOut, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { FieldFormModal } from './components/FieldFormModal';
import { FieldMap } from './components/FieldMap';
import {
  ActivityLogView,
  ClimateTelemetryView,
  CompatibilityMatrixView,
} from './components/MatrixAndTelemetryViews';
import { RotationCards } from './components/RotationCards';
import { SoilAuditCard } from './components/SoilAuditCard';
import { replaceOfflineFields } from './db/offlineDb';
import { auth, signInWithGoogle, signOutUser } from './firebase';
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
  updateField,
  updateFieldSoil,
} from './services/apiClient';
import type { FieldSavePayload } from './services/apiClient';
import {
  ensureUserSeeded,
  subscribeFieldActivities,
  subscribeUserFields,
} from './services/firestoreSync';
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

  // Firebase Auth & Firestore sync state
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [cloudSynced, setCloudSynced] = useState(false);
  const fieldsRef = useRef<FieldRecord[]>([]);

  // Add / Modify Field modal state
  const [fieldModalOpen, setFieldModalOpen] = useState(false);
  const [fieldModalMode, setFieldModalMode] = useState<'create' | 'edit'>('create');
  const [editingField, setEditingField] = useState<FieldRecord | null>(null);
  const [capturedGeometry, setCapturedGeometry] = useState<GeoJsonPolygon | null>(null);
  const [capturedSuggestedName, setCapturedSuggestedName] = useState<string | undefined>(undefined);

  const selectedField = fields.find((f) => f.id === selectedFieldId) || fields[0] || null;

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthReady(true);
      if (!user) {
        setCloudSynced(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const [fieldRes, matrixRes] = await Promise.all([
          fetchFields(),
          fetchMatrixAndCrops(),
        ]);
        if (cancelled) return;
        setCrops(matrixRes.crops);
        setCoverCrops(matrixRes.cover_crops);
        setMatrix(matrixRes.matrix);

        if (!auth.currentUser) {
          setFields(fieldRes.fields);
          setFromOfflineCache(fieldRes.fromOfflineCache);
          if (fieldRes.fields[0]) {
            setSelectedFieldId(fieldRes.fields[0].id);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setErrorBanner(
            err instanceof Error ? err.message : 'Unable to load Cosmic Crisp workspace.'
          );
        }
      } finally {
        if (!cancelled && !auth.currentUser) setLoadingFields(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to real-time Cloud Firestore fields when signed in
  useEffect(() => {
    if (!authReady || !currentUser) return;
    let active = true;
    let unsubFields: (() => void) | null = null;

    async function connectFirestore() {
      if (!currentUser) return;
      setLoadingFields(true);
      setErrorBanner(null);
      try {
        const seedSource =
          fieldsRef.current.length > 0
            ? fieldsRef.current
            : (await fetchFields()).fields;

        await ensureUserSeeded(currentUser.uid, seedSource);
        if (!active) return;

        unsubFields = subscribeUserFields(
          currentUser.uid,
          (cloudFields) => {
            if (!active) return;
            setFields(cloudFields);
            setCloudSynced(true);
            setLoadingFields(false);
            setFromOfflineCache(false);
            void replaceOfflineFields(cloudFields);
            setSelectedFieldId((prev) =>
              cloudFields.some((f) => f.id === prev) ? prev : cloudFields[0]?.id || ''
            );
          },
          (err) => {
            if (!active) return;
            setErrorBanner(err.message);
            setLoadingFields(false);
          }
        );
      } catch (err) {
        if (active) {
          setErrorBanner(
            err instanceof Error ? err.message : 'Unable to connect to Cloud Firestore.'
          );
          setLoadingFields(false);
        }
      }
    }

    void connectFirestore();
    return () => {
      active = false;
      if (unsubFields) unsubFields();
    };
  }, [authReady, currentUser?.uid]);

  // Subscribe to Firestore activities when authenticated
  useEffect(() => {
    if (!authReady || !currentUser || !selectedField) return;
    setActivities([]);
    const unsub = subscribeFieldActivities(
      currentUser.uid,
      selectedField.id,
      (cloudActivities) => {
        setActivities(cloudActivities);
      }
    );
    return () => unsub();
  }, [authReady, currentUser?.uid, selectedField?.id]);

  // Automatically compute rotation plan & load activity log whenever selected field changes
  // unless field is saved as 'pending' awaiting user pre-analysis review
  useEffect(() => {
    if (!selectedField) {
      setRotationData(null);
      setActivities([]);
      return;
    }
    let cancelled = false;

    async function loadFieldDetails() {
      if (!selectedField) return;
      setErrorBanner(null);

      if (selectedField.analysis_status === 'pending') {
        setRotationData(null);
        setGeneratingPlan(false);
        if (!currentUser) {
          setActivities([]);
          try {
            const actRes = await fetchActivities(selectedField.id);
            if (!cancelled) setActivities(actRes);
          } catch {
            // Ignore offline activity load failure
          }
        }
        return;
      }

      setRotationData((prev) =>
        prev && prev.field_id === selectedField.id ? prev : null
      );
      setGeneratingPlan(true);
      try {
        const rotRes = await generateRotations(
          selectedField,
          selectedField.previous_crops[0]
        );
        if (cancelled) return;
        setRotationData(rotRes.result);
        setFromOfflineCache(rotRes.fromOfflineCache);

        if (!currentUser) {
          const actRes = await fetchActivities(selectedField.id);
          if (!cancelled) setActivities(actRes);
        }
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
  }, [selectedField?.id, selectedField?.analysis_status, selectedField?.updated_at, currentUser?.uid]);

  const openNewFieldModal = (geometry?: GeoJsonPolygon, suggestedName?: string) => {
    setFieldModalMode('create');
    setEditingField(null);
    setCapturedGeometry(geometry || null);
    setCapturedSuggestedName(suggestedName);
    setFieldModalOpen(true);
  };

  const openEditFieldModal = (field: FieldRecord) => {
    setFieldModalMode('edit');
    setEditingField(field);
    setCapturedGeometry(null);
    setCapturedSuggestedName(undefined);
    setFieldModalOpen(true);
  };

  const handleFieldModalSubmit = async (
    payload: FieldSavePayload,
    options: { runAnalysis: boolean; fieldId?: string }
  ) => {
    if (fieldModalMode === 'edit' && options.fieldId) {
      const targetExisting =
        fields.find((f) => f.id === options.fieldId) || editingField;
      const updated = await updateField(
        options.fieldId,
        payload,
        targetExisting
      );
      setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setSelectedFieldId(updated.id);
      setActiveTab('planner');
      if (options.runAnalysis) {
        setGeneratingPlan(true);
        try {
          const rotRes = await generateRotations(updated, updated.previous_crops[0]);
          setRotationData(rotRes.result);
          setFromOfflineCache(rotRes.fromOfflineCache);
        } finally {
          setGeneratingPlan(false);
        }
      } else {
        setRotationData(null);
      }
      return;
    }

    const created = await createField(payload);
    setFields((prev) => [created, ...prev.filter((f) => f.id !== created.id)]);
    setSelectedFieldId(created.id);
    setActiveTab('planner');
    if (options.runAnalysis) {
      setGeneratingPlan(true);
      try {
        const rotRes = await generateRotations(created, created.previous_crops[0]);
        setRotationData(rotRes.result);
        setFromOfflineCache(rotRes.fromOfflineCache);
      } finally {
        setGeneratingPlan(false);
      }
    } else {
      setRotationData(null);
    }
  };

  const handleAnalyzePendingField = async (field: FieldRecord) => {
    setGeneratingPlan(true);
    setErrorBanner(null);
    try {
      const updated = await updateField(
        field.id,
        { analysis_status: 'analyzed' },
        field
      );
      setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      const rotRes = await generateRotations(updated, updated.previous_crops[0]);
      setRotationData(rotRes.result);
      setFromOfflineCache(rotRes.fromOfflineCache);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to analyze field');
    } finally {
      setGeneratingPlan(false);
    }
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
    const existingTarget = fields.find((f) => f.id === fieldId) || null;
    const updated = await updateFieldSoil(fieldId, payload, existingTarget);
    setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    if (updated.analysis_status !== 'pending') {
      setGeneratingPlan(true);
      try {
        const rotRes = await generateRotations(updated, updated.previous_crops[0]);
        setRotationData(rotRes.result);
        setFromOfflineCache(rotRes.fromOfflineCache);
      } finally {
        setGeneratingPlan(false);
      }
    }
  };

  const handlePreviousCropChange = async (prevCropId: string) => {
    if (!selectedField) return;
    setGeneratingPlan(true);
    try {
      const nextPrev = [prevCropId, ...selectedField.previous_crops.slice(1)];
      const updated = await updateField(
        selectedField.id,
        { previous_crops: nextPrev },
        selectedField
      );
      setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      if (updated.analysis_status !== 'pending') {
        const rotRes = await generateRotations(updated, prevCropId);
        setRotationData(rotRes.result);
      }
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleDeleteField = async (fieldId: string) => {
    setErrorBanner(null);
    try {
      await deleteField(fieldId);
      const remaining = fields.filter((f) => f.id !== fieldId);
      setFields(remaining);
      if (selectedFieldId === fieldId) {
        setSelectedFieldId(remaining[0]?.id || '');
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to delete field');
    }
  };

  const handleRefreshTelemetry = async (fieldId: string) => {
    const target = fields.find((f) => f.id === fieldId);
    if (!target) return;
    setRefreshingTelemetry(true);
    try {
      const telemetry = await refreshFieldTelemetry(target);
      const updatedField = { ...target, telemetry };
      setFields((prev) =>
        prev.map((f) => (f.id === fieldId ? updatedField : f))
      );
      const rotRes = await generateRotations(updatedField);
      setRotationData(rotRes.result);
    } finally {
      setRefreshingTelemetry(false);
    }
  };

  const handleLogActivity = async (
    entry: Omit<ActivityLogEntry, 'id' | 'synced' | 'created_at'>
  ) => {
    await logActivity(entry);
    if (selectedField && !currentUser) {
      const updated = await fetchActivities(selectedField.id);
      setActivities(updated);
    }
  };

  const handleSyncPending = async () => {
    if (!selectedField) return;
    await syncPendingActivities(selectedField.id);
    if (!currentUser) {
      const updated = await fetchActivities(selectedField.id);
      setActivities(updated);
    }
  };

  const handleSignIn = async () => {
    setSigningIn(true);
    setErrorBanner(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Google Sign-In failed.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setErrorBanner(null);
    await signOutUser();
    const res = await fetchFields();
    setFields(res.fields);
    setSelectedFieldId(res.fields[0]?.id || '');
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
            onClick={() => openNewFieldModal()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Field
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
          {/* Cloud Database Connection Card */}
          <section className="border border-slate-200 bg-white rounded-lg p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                <Database className="w-3.5 h-3.5 text-emerald-700" />
                Cloud Database
              </div>
              {currentUser && (
                <span className="text-[11px] font-medium text-emerald-700">
                  {cloudSynced ? 'Synced' : 'Connecting...'}
                </span>
              )}
            </div>

            {currentUser ? (
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-xs text-slate-600 truncate">
                  {currentUser.email || currentUser.displayName || 'Signed in'}
                </span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 shrink-0 cursor-pointer"
                >
                  <LogOut className="w-3 h-3" />
                  Sign out
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Sign in with Google to persist added, modified, and deleted fields to Cloud Firestore.
                </p>
                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={!authReady || signingIn}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  {signingIn ? 'Signing in...' : 'Sign in with Google'}
                </button>
              </div>
            )}
          </section>

          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
              <div>
                <h1 className="text-sm font-semibold text-slate-900">
                  Registered Field Parcels
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {fields.length} parcels · Select to inspect
                </p>
              </div>
              <button
                type="button"
                onClick={() => openNewFieldModal()}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            </div>

            {loadingFields ? (
              <div className="p-4 space-y-2">
                <div className="h-12 bg-slate-100 rounded animate-pulse" />
                <div className="h-12 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : fields.length === 0 ? (
              <div className="p-5 text-center space-y-3">
                <p className="text-xs text-slate-500">
                  No field parcels saved yet.
                </p>
                <button
                  type="button"
                  onClick={() => openNewFieldModal()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add First Field
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {fields.map((f) => {
                  const isSelected = selectedField?.id === f.id;
                  const areaHa = f.acreage / 2.47105381;
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
                          className="text-left flex-1 cursor-pointer min-w-0"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 leading-snug truncate">
                              {f.name}
                            </span>
                            {f.analysis_status === 'pending' && (
                              <span className="text-[10px] font-medium text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded shrink-0">
                                Pending
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 truncate">
                            {f.location_label}
                          </div>
                          <div className="text-xs font-mono tabular-nums text-slate-600 mt-1">
                            {areaHa.toFixed(2)} ha · {f.acreage.toFixed(1)} ac · pH {f.soil.ph.toFixed(1)}
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditFieldModal(f)}
                            className="p-1 text-slate-400 hover:text-emerald-700 rounded cursor-pointer"
                            title="Modify field details"
                            aria-label={`Modify ${f.name}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteField(f.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                            title="Delete parcel"
                            aria-label={`Delete ${f.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">Parcel Area</span>
                  <button
                    type="button"
                    onClick={() => openEditFieldModal(selectedField)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:text-emerald-800 cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                    Modify Field
                  </button>
                </div>
                <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
                  {(selectedField.acreage / 2.47105381).toFixed(2)}
                  <span className="text-xs font-normal text-slate-400 ml-1">ha</span>
                  <span className="text-xs font-normal text-slate-400 ml-2">
                    ({selectedField.acreage.toFixed(1)} ac)
                  </span>
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
                  {selectedField.analysis_status === 'pending'
                    ? 'Awaiting analysis'
                    : rotationData?.ranked_plans[0]
                      ? `$${rotationData.ranked_plans[0].cumulative_3yr_net_margin_usd_acre.toFixed(0)}/ac 3-yr net`
                      : 'Run optimizer'}
                </div>
              </div>
            </section>
          )}

          {/* Field Notes & Recorded Yields strip (if present) */}
          {selectedField &&
            (selectedField.notes?.trim() ||
              (selectedField.yields && selectedField.yields.length > 0)) && (
              <section className="border border-slate-200 bg-white rounded-lg px-5 py-3.5 flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1 min-w-[200px] flex-1">
                  <div className="text-xs font-semibold text-slate-800">
                    Field Notes & Yield History — {selectedField.name}
                  </div>
                  {selectedField.notes?.trim() && (
                    <p className="text-xs text-slate-600">{selectedField.notes}</p>
                  )}
                  {selectedField.yields && selectedField.yields.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
                      {selectedField.yields.map((y) => (
                        <span
                          key={y.id}
                          className="text-xs font-mono tabular-nums text-slate-700"
                        >
                          <span className="text-slate-400">{y.year}:</span>{' '}
                          <span className="font-semibold">{y.value}</span> {y.unit}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => openEditFieldModal(selectedField)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5 text-slate-500" />
                  Edit Details
                </button>
              </section>
            )}

          {activeTab === 'planner' && (
            <>
              <FieldMap
                fields={fields}
                selectedField={selectedField}
                onSelectField={setSelectedFieldId}
                onPolygonCaptured={(geom, suggestedName) =>
                  openNewFieldModal(geom, suggestedName)
                }
                externalStartDrawSignal={drawSignal}
              />

              {selectedField && (
                <SoilAuditCard
                  field={selectedField}
                  onSaveOverride={handleSaveSoilOverride}
                />
              )}

              {selectedField?.analysis_status === 'pending' ? (
                <section className="border border-amber-200 bg-amber-50/60 rounded-lg p-6 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Field Details Saved — Ready to Analyze
                    </h2>
                    <p className="text-xs text-slate-600 mt-1 max-w-2xl">
                      Review or modify field area, prior crop, historical yields, notes, and soil lab overrides before running the 4-Stage Rotation Decision Engine.
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => openEditFieldModal(selectedField)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Modify Details
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAnalyzePendingField(selectedField)}
                      disabled={generatingPlan}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {generatingPlan ? 'Analyzing Field...' : 'Analyze Field'}
                    </button>
                  </div>
                </section>
              ) : (
                <RotationCards
                  field={selectedField}
                  rotationData={rotationData}
                  loading={generatingPlan}
                  fromOfflineCache={fromOfflineCache}
                />
              )}
            </>
          )}

          {activeTab === 'matrix' && (
            <CompatibilityMatrixView
              crops={crops}
              coverCrops={coverCrops}
              matrix={matrix}
              selectedField={selectedField}
              rotationData={rotationData}
            />
          )}

          {activeTab === 'telemetry' &&
            (selectedField ? (
              <ClimateTelemetryView
                field={selectedField}
                onRefreshTelemetry={handleRefreshTelemetry}
                refreshing={refreshingTelemetry}
              />
            ) : (
              <section className="border border-slate-200 bg-white rounded-lg p-8 text-center text-sm text-slate-600">
                Select or add a field parcel to inspect NASA POWER climate telemetry.
              </section>
            ))}

          {activeTab === 'activities' &&
            (selectedField ? (
              <ActivityLogView
                field={selectedField}
                crops={[...crops, ...coverCrops]}
                activities={activities}
                onLogActivity={handleLogActivity}
                onSyncPending={handleSyncPending}
              />
            ) : (
              <section className="border border-slate-200 bg-white rounded-lg p-8 text-center text-sm text-slate-600">
                Select or add a field parcel to record and inspect field activities.
              </section>
            ))}
        </main>
      </div>

      <FieldFormModal
        isOpen={fieldModalOpen}
        mode={fieldModalMode}
        crops={crops}
        initialField={editingField}
        initialGeometry={capturedGeometry}
        initialSuggestedName={capturedSuggestedName}
        defaultCenter={
          selectedField
            ? [selectedField.centroid_lat, selectedField.centroid_lon]
            : [43.615, -116.202]
        }
        onClose={() => setFieldModalOpen(false)}
        onRequestMapDraw={() => {
          setActiveTab('planner');
          setDrawSignal((s) => s + 1);
        }}
        onSubmit={handleFieldModalSubmit}
      />
    </div>
  );
}
