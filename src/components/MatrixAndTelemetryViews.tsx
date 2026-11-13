import React, { useState } from 'react';
import { RefreshCw, CloudOff, CheckCircle2, Plus } from 'lucide-react';
import type {
  ActivityLogEntry,
  ClimateTelemetry,
  CropSpec,
  FieldRecord,
} from '../types';

/* -------------------------------------------------------------------------- */
/* 1. 6x6 Master Crop Rotation Compatibility Matrix View                       */
/* -------------------------------------------------------------------------- */
export const CompatibilityMatrixView: React.FC<{
  crops: CropSpec[];
  coverCrops: CropSpec[];
  matrix: Record<string, Record<string, number>>;
}> = ({ crops, coverCrops, matrix }) => {
  const [hoveredCell, setHoveredCell] = useState<{
    prev: string;
    next: string;
    score: number;
  } | null>(null);

  const cellStyle = (score: number) => {
    if (score >= 85) return 'bg-emerald-50 text-emerald-900 font-semibold';
    if (score >= 70) return 'bg-slate-50 text-slate-800 font-medium';
    if (score >= 50) return 'bg-amber-50 text-amber-900';
    return 'bg-rose-50 text-rose-800 font-semibold';
  };

  return (
    <div className="space-y-6">
      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              6×6 Master Crop Rotation Compatibility Matrix
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Baseline agronomic transition scores B(Prev → Next) used in Stage 2 before legume N-credit and SMAP moisture modifiers
            </p>
          </div>
          {hoveredCell && (
            <div className="text-xs font-mono tabular-nums text-slate-700">
              {hoveredCell.prev} → {hoveredCell.next}: <span className="font-bold">{hoveredCell.score}/100</span>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 text-left font-semibold">Previous Crop \ Next Crop</th>
                {crops.map((nextCrop) => (
                  <th key={nextCrop.id} className="py-3 px-3 text-center font-semibold">
                    <div>{nextCrop.name}</div>
                    <div className="font-normal text-slate-400">{nextCrop.botanical_family}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {crops.map((prevCrop) => (
                <tr key={prevCrop.id}>
                  <td className="py-3 px-4 border-r border-slate-200 bg-slate-50/40">
                    <div className="font-semibold text-slate-900">{prevCrop.name}</div>
                    <div className="text-slate-500">{prevCrop.botanical_family}</div>
                  </td>
                  {crops.map((nextCrop) => {
                    const score = matrix[prevCrop.id]?.[nextCrop.id] ?? 0;
                    return (
                      <td
                        key={`${prevCrop.id}-${nextCrop.id}`}
                        onMouseEnter={() =>
                          setHoveredCell({
                            prev: prevCrop.name,
                            next: nextCrop.name,
                            score,
                          })
                        }
                        onMouseLeave={() => setHoveredCell(null)}
                        className={`py-3 px-3 text-center font-mono tabular-nums border-r border-slate-100 last:border-r-0 transition-colors ${cellStyle(
                          score
                        )}`}
                      >
                        {score}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Physiological Gate Baselines + Cover Crops */}
      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Crop Group Gate Tolerances & Automated Cover Crops
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Seeded physiological bounds enforced by Stage 1 Gates and Stage 4 Overwinter Cover Crop Injection
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-2.5 px-4 font-semibold">Crop Group</th>
                <th className="py-2.5 px-3 font-semibold">Role</th>
                <th className="py-2.5 px-3 font-semibold">pH Range</th>
                <th className="py-2.5 px-3 font-semibold">Max EC</th>
                <th className="py-2.5 px-3 font-semibold">Min GDD</th>
                <th className="py-2.5 px-3 font-semibold">Frost-Free</th>
                <th className="py-2.5 px-3 font-semibold">Break Yrs</th>
                <th className="py-2.5 px-3 font-semibold">Water Req</th>
                <th className="py-2.5 px-3 font-semibold">N Balance / Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
              {[...crops, ...coverCrops].map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-sans">
                    <div className="font-medium text-slate-900">{c.name}</div>
                    <div className="text-slate-500">{c.botanical_family}</div>
                  </td>
                  <td className="py-2.5 px-3 font-sans text-slate-700">
                    {c.is_cover_crop ? 'Overwinter Cover' : c.is_legume ? 'Legume Cash' : 'Cash Crop'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-800">
                    {c.ph_min.toFixed(1)}–{c.ph_max.toFixed(1)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-800">{c.max_salinity_dsm.toFixed(1)} dS/m</td>
                  <td className="py-2.5 px-3 text-slate-800">{c.gdd_required} °C·d</td>
                  <td className="py-2.5 px-3 text-slate-800">{c.frost_free_days_min}d (+14d)</td>
                  <td className="py-2.5 px-3 text-slate-800">{c.min_rotation_break_years} yr</td>
                  <td className="py-2.5 px-3 text-slate-800">{c.water_demand_mm} mm</td>
                  <td className="py-2.5 px-3 text-slate-800">
                    {c.n_balance_lbs_acre >= 0 ? `+${c.n_balance_lbs_acre}` : c.n_balance_lbs_acre} lb
                    {c.n_credit_provided_lbs_acre > 0 ? ` (+${c.n_credit_provided_lbs_acre} credit)` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 2. NASA POWER Climate Telemetry View                                       */
/* -------------------------------------------------------------------------- */
export const ClimateTelemetryView: React.FC<{
  field: FieldRecord;
  onRefreshTelemetry: (fieldId: string) => Promise<void>;
  refreshing: boolean;
}> = ({ field, onRefreshTelemetry, refreshing }) => {
  const { telemetry } = field;
  const [hoveredMonthIdx, setHoveredMonthIdx] = useState<number | null>(null);

  const series = telemetry.monthly_series;
  const maxWater = Math.max(
    180,
    ...series.map((m) => Math.max(m.precip_mm, m.et0_mm))
  );
  const chartW = 720;
  const chartH = 220;
  const padL = 42;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const xPos = (idx: number) =>
    padL + (idx / Math.max(1, series.length - 1)) * innerW;
  const yWater = (val: number) =>
    padT + innerH - (val / maxWater) * innerH;

  const et0Points = series
    .map((m, i) => `${xPos(i).toFixed(1)},${yWater(m.et0_mm).toFixed(1)}`)
    .join(' ');

  const activePoint: ClimateTelemetry['monthly_series'][number] | null =
    hoveredMonthIdx !== null ? series[hoveredMonthIdx] : null;

  return (
    <div className="space-y-6">
      <section className="border border-slate-200 bg-white rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              NASA POWER Meteorological Telemetry & 0.5° Grid Cache
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Source: {telemetry.data_source} · Grid Cell ({telemetry.grid_lat.toFixed(1)}°,{' '}
              {telemetry.grid_lon.toFixed(1)}°) · Cache Key {telemetry.cache_key} ·{' '}
              {telemetry.cache_hit ? '24h Cache Hit' : 'Live Fetch'} · ET₀ Method: {telemetry.et0_method}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onRefreshTelemetry(field.id)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Querying NASA POWER...' : 'Refresh Grid Telemetry'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200">
          <div className="p-4">
            <div className="text-xs text-slate-500">85th-Pct GDD</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
              {telemetry.gdd_85th_percentile}
              <span className="text-xs font-normal text-slate-400 ml-1">°C·d</span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500">Frost-Free Window</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
              {telemetry.frost_free_days}
              <span className="text-xs font-normal text-slate-400 ml-1">days</span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500">Annual Precip</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
              {telemetry.annual_precip_mm}
              <span className="text-xs font-normal text-slate-400 ml-1">mm</span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500">Growing Precip</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
              {telemetry.growing_season_precip_mm}
              <span className="text-xs font-normal text-slate-400 ml-1">mm</span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500">Mean Daily ET₀</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
              {telemetry.mean_et0_mm_day.toFixed(2)}
              <span className="text-xs font-normal text-slate-400 ml-1">mm/d</span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500">Elevation</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
              {telemetry.elevation_m}
              <span className="text-xs font-normal text-slate-400 ml-1">m</span>
            </div>
          </div>
        </div>

        {/* SVG Chart: Monthly Precipitation Bars vs Reference ET0 Curve */}
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-2.5 bg-emerald-600/80 inline-block rounded-xs" />
                Monthly Precipitation (mm)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-amber-600 inline-block" />
                FAO-56 Hargreaves ET₀ (mm)
              </span>
            </div>
            {activePoint && (
              <div className="text-xs font-mono tabular-nums text-slate-800">
                {activePoint.month}: Precip {activePoint.precip_mm} mm · ET₀ {activePoint.et0_mm} mm · GDD{' '}
                {activePoint.gdd_c} °C·d · T {activePoint.t_min_c}°/{activePoint.t_max_c}°C
              </div>
            )}
          </div>

          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-56 overflow-visible">
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const y = padT + innerH * (1 - frac);
              const val = Math.round(maxWater * frac);
              return (
                <g key={frac}>
                  <line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="#E2E8F0" strokeWidth={1} />
                  <text
                    x={padL - 8}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {series.map((m, idx) => {
              const x = xPos(idx);
              const barW = 24;
              const y = yWater(m.precip_mm);
              const h = padT + innerH - y;
              return (
                <g
                  key={m.month}
                  onMouseEnter={() => setHoveredMonthIdx(idx)}
                  onMouseLeave={() => setHoveredMonthIdx(null)}
                  className="cursor-crosshair"
                >
                  <rect
                    x={x - barW / 2}
                    y={y}
                    width={barW}
                    height={Math.max(0, h)}
                    fill={hoveredMonthIdx === idx ? '#047857' : '#10B981'}
                    opacity={0.78}
                    rx={2}
                  />
                  <text
                    x={x}
                    y={chartH - 8}
                    textAnchor="middle"
                    className="fill-slate-500 text-[10px] font-mono"
                  >
                    {m.month}
                  </text>
                </g>
              );
            })}

            <polyline
              fill="none"
              stroke="#D97706"
              strokeWidth={2}
              points={et0Points}
            />
            {series.map((m, idx) => (
              <circle
                key={`dot-${m.month}`}
                cx={xPos(idx)}
                cy={yWater(m.et0_mm)}
                r={hoveredMonthIdx === idx ? 4.5 : 3}
                fill="#D97706"
              />
            ))}
          </svg>
        </div>
      </section>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 3. Dexie.js IndexedDB Offline Activity Log View                            */
/* -------------------------------------------------------------------------- */
export const ActivityLogView: React.FC<{
  field: FieldRecord;
  crops: CropSpec[];
  activities: ActivityLogEntry[];
  onLogActivity: (entry: Omit<ActivityLogEntry, 'id' | 'synced' | 'created_at'>) => Promise<void>;
  onSyncPending: () => Promise<void>;
}> = ({ field, crops, activities, onLogActivity, onSyncPending }) => {
  const [activityType, setActivityType] =
    useState<ActivityLogEntry['activity_type']>('Planting');
  const [cropName, setCropName] = useState(crops[0]?.name || 'Corn (Maize)');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [nApplied, setNApplied] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pendingCount = activities.filter((a) => !a.synced).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onLogActivity({
        field_id: field.id,
        activity_type: activityType,
        crop_name: cropName,
        date,
        notes,
        n_applied_lbs_acre: nApplied ? Number(nApplied) : undefined,
      });
      setNotes('');
      setNApplied('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section className="border border-slate-200 bg-white rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-900">Log Field Operation</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Persists immediately to IndexedDB via Dexie.js and syncs with the Cosmic Crisp backend when online.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Operation Type
            </label>
            <select
              value={activityType}
              onChange={(e) =>
                setActivityType(e.target.value as ActivityLogEntry['activity_type'])
              }
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
            >
              <option value="Planting">Planting</option>
              <option value="Soil Sample">Soil Sample</option>
              <option value="Cover Crop Termination">Cover Crop Termination</option>
              <option value="Fertilizer Application">Fertilizer Application</option>
              <option value="Irrigation">Irrigation</option>
              <option value="Field Observation">Field Observation</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Crop / Cover Crop
            </label>
            <select
              value={cropName}
              onChange={(e) => setCropName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
            >
              {crops.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
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
                max="300"
                placeholder="Optional"
                value={nApplied}
                onChange={(e) => setNApplied(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Agronomic Notes
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Stand count, residue cover, moisture depth..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {submitting ? 'Saving Entry...' : 'Save Field Log Entry'}
          </button>
        </form>
      </section>

      <section className="lg:col-span-2 border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-slate-50/70">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Field Activity History · {field.name}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {activities.length} logged operations · {pendingCount} queued offline
            </p>
          </div>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={onSyncPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-300 rounded-md hover:bg-amber-100 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sync {pendingCount} Offline Entries
            </button>
          )}
        </div>

        {activities.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No operations logged for this field yet. Record a planting, soil pull, or cover crop termination on the left.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {activities.map((act) => (
              <div key={act.id} className="p-4 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono tabular-nums text-slate-700 font-medium">
                      {act.date}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-800">{act.activity_type}</span>
                    <span aria-hidden="true">·</span>
                    <span>{act.crop_name}</span>
                    {act.n_applied_lbs_acre !== undefined && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {act.n_applied_lbs_acre} lbs N/ac
                        </span>
                      </>
                    )}
                  </div>
                  {act.notes && (
                    <p className="mt-1 text-sm text-slate-700">{act.notes}</p>
                  )}
                </div>

                <div className="text-xs shrink-0">
                  {act.synced ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Synced
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <CloudOff className="w-3.5 h-3.5" />
                      Offline Queue
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
