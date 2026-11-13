'use client';

import React, { useMemo, useState } from 'react';
import * as d3 from 'd3';
import { SlidersHorizontal, X } from 'lucide-react';
import type { FieldResponseDTO, SoilHistoryPointDTO, SoilOverrideRequest } from '@/lib/api';

interface SoilAuditCardProps {
  field: FieldResponseDTO;
  onSaveOverride: (fieldId: string, payload: SoilOverrideRequest) => Promise<void>;
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 185;
const MARGIN = { top: 16, right: 24, bottom: 28, left: 46 };

function SoilOmTrendChart({ history }: { history: SoilHistoryPointDTO[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const sorted = useMemo(
    () => [...history].sort((a, b) => a.season_year - b.season_year),
    [history]
  );

  const chart = useMemo(() => {
    const innerW = CHART_WIDTH - MARGIN.left - MARGIN.right;
    const innerH = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

    const omValues = sorted.map((d) => d.organic_matter_pct);
    const minOm = Math.max(0, Math.floor((Math.min(...omValues) - 0.35) * 10) / 10);
    const maxOm = Math.ceil((Math.max(...omValues) + 0.35) * 10) / 10;

    const xScale = d3
      .scalePoint<string>()
      .domain(sorted.map((d) => d.season_label))
      .range([MARGIN.left, MARGIN.left + innerW])
      .padding(0.25);

    const yScale = d3
      .scaleLinear()
      .domain([minOm, maxOm])
      .nice(4)
      .range([MARGIN.top + innerH, MARGIN.top]);

    const lineGen = d3
      .line<SoilHistoryPointDTO>()
      .x((d) => xScale(d.season_label) ?? MARGIN.left)
      .y((d) => yScale(d.organic_matter_pct))
      .curve(d3.curveMonotoneX);

    const areaGen = d3
      .area<SoilHistoryPointDTO>()
      .x((d) => xScale(d.season_label) ?? MARGIN.left)
      .y0(MARGIN.top + innerH)
      .y1((d) => yScale(d.organic_matter_pct))
      .curve(d3.curveMonotoneX);

    return {
      innerH,
      yTicks: yScale.ticks(4),
      yScale,
      linePath: lineGen(sorted) || '',
      areaPath: areaGen(sorted) || '',
      points: sorted.map((d) => ({
        point: d,
        cx: xScale(d.season_label) ?? MARGIN.left,
        cy: yScale(d.organic_matter_pct),
      })),
    };
  }, [sorted]);

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const delta = Number((last.organic_matter_pct - first.organic_matter_pct).toFixed(2));
  const activePoint = hoveredIdx !== null ? sorted[hoveredIdx] : last;

  const trendTone =
    delta > 0.05 ? 'text-emerald-700' : delta < -0.05 ? 'text-rose-700' : 'text-slate-700';
  const trendLabel =
    delta > 0.05
      ? `▲ +${delta.toFixed(1)}% Building OM`
      : delta < -0.05
        ? `▼ ${delta.toFixed(1)}% Depleting OM`
        : '● Stable OM';

  return (
    <div className="border-t border-slate-200 px-5 py-4 bg-slate-50/40">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h3 className="text-xs font-semibold text-slate-800">
            Historical Soil Organic Matter Trend ({sorted.length} Seasons)
          </h3>
          <span className={`text-xs font-mono tabular-nums font-medium ${trendTone}`}>
            {trendLabel}
          </span>
        </div>
        <div className="text-xs font-mono tabular-nums text-slate-600">
          <span className="font-semibold text-slate-900">
            {activePoint.season_label} · {activePoint.organic_matter_pct.toFixed(1)}% OM
          </span>{' '}
          · pH {activePoint.ph.toFixed(1)} · {activePoint.crop_grown} ({activePoint.source})
        </div>
      </div>

      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full h-44 overflow-visible"
        role="img"
        aria-label="D3 line chart of historical soil organic matter percentage"
      >
        <defs>
          <linearGradient id="omAreaFillNext" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#059669" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#059669" stopOpacity={0.01} />
          </linearGradient>
        </defs>

        {chart.yTicks.map((tick) => {
          const y = chart.yScale(tick);
          return (
            <g key={tick}>
              <line x1={MARGIN.left} y1={y} x2={CHART_WIDTH - MARGIN.right} y2={y} stroke="#E2E8F0" strokeWidth={1} />
              <text x={MARGIN.left - 8} y={y + 3.5} textAnchor="end" className="fill-slate-400 text-[10px] font-mono tabular-nums">
                {tick.toFixed(1)}%
              </text>
            </g>
          );
        })}

        <path d={chart.areaPath} fill="url(#omAreaFillNext)" />
        <path d={chart.linePath} fill="none" stroke={delta < -0.05 ? '#DC2626' : '#047857'} strokeWidth={2} />

        {hoveredIdx !== null && chart.points[hoveredIdx] && (
          <line
            x1={chart.points[hoveredIdx].cx}
            y1={MARGIN.top}
            x2={chart.points[hoveredIdx].cx}
            y2={MARGIN.top + chart.innerH}
            stroke="#94A3B8"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {chart.points.map(({ point, cx, cy }, idx) => {
          const active = hoveredIdx === idx;
          return (
            <g
              key={point.season_year}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="cursor-crosshair"
            >
              <rect x={cx - 28} y={MARGIN.top} width={56} height={chart.innerH + 22} fill="transparent" />
              <circle
                cx={cx}
                cy={cy}
                r={active ? 5.5 : 3.5}
                fill="#FFFFFF"
                stroke={delta < -0.05 ? '#DC2626' : '#047857'}
                strokeWidth={2}
              />
              <text
                x={cx}
                y={CHART_HEIGHT - 6}
                textAnchor="middle"
                className={`text-[10px] font-mono tabular-nums ${active ? 'fill-slate-900 font-semibold' : 'fill-slate-500'}`}
              >
                {point.season_label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function SoilAuditCard({ field, onSaveOverride }: SoilAuditCardProps) {
  const { soil, telemetry } = field;
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [ph, setPh] = useState(soil.ph.toString());
  const [om, setOm] = useState(soil.organic_matter_pct.toString());
  const [texture, setTexture] = useState(soil.soil_texture);
  const [cec, setCec] = useState(soil.cec_meq.toString());
  const [salinity, setSalinity] = useState(soil.salinity_dsm.toString());
  const [slope, setSlope] = useState(soil.mean_slope_pct.toString());
  const [smap, setSmap] = useState(soil.smap_rootzone_moisture.toString());
  const [irrigated, setIrrigated] = useState(soil.irrigated);

  const openModal = () => {
    setPh(soil.ph.toString());
    setOm(soil.organic_matter_pct.toString());
    setTexture(soil.soil_texture);
    setCec(soil.cec_meq.toString());
    setSalinity(soil.salinity_dsm.toString());
    setSlope(soil.mean_slope_pct.toString());
    setSmap(soil.smap_rootzone_moisture.toString());
    setIrrigated(soil.irrigated);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveOverride(field.id, {
        ph: Number(ph) || 6.5,
        organic_matter_pct: Number(om) || 3.0,
        soil_texture: texture.trim() || 'Loam',
        cec_meq: Number(cec) || 16.0,
        salinity_dsm: Number(salinity) || 0.4,
        mean_slope_pct: Number(slope) || 2.0,
        smap_rootzone_moisture: Math.max(0, Math.min(100, Math.round(Number(smap) || 45))),
        irrigated,
      });
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const smapPenaltyRisk = soil.smap_rootzone_moisture < 30 && !soil.irrigated;
  const slopeErosionTrigger = soil.mean_slope_pct > 5.0;
  const omHistory = soil.om_history || [];

  return (
    <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Soil Chemistry, Slope & NASA POWER Climate Summary
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Soil: {soil.source}
            {soil.mukey ? ` · MUKEY ${soil.mukey}` : ''} · Climate: {telemetry.data_source} (Grid{' '}
            {telemetry.grid_lat.toFixed(1)}°, {telemetry.grid_lon.toFixed(1)}° ·{' '}
            {telemetry.cache_hit ? '24h Cache Hit' : 'Live Query'})
          </p>
        </div>

        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
          Override Lab Soil Test
        </button>
      </div>

      {/* Soil & Hydrology Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">Soil pH</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
            {soil.ph.toFixed(1)}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">1:1 H₂O</div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500">Organic Matter</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
            {soil.organic_matter_pct.toFixed(1)}
            <span className="text-xs font-normal text-slate-400 ml-1">%</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">0–30 cm</div>
        </div>

        <div className="p-4 col-span-2 sm:col-span-1">
          <div className="text-xs text-slate-500">Soil Texture</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 leading-snug">
            {soil.soil_texture}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">CEC {soil.cec_meq.toFixed(1)} meq</div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500">Salinity (EC)</div>
          <div
            className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
              soil.salinity_dsm > 1.7 ? 'text-amber-700' : 'text-slate-900'
            }`}
          >
            {soil.salinity_dsm.toFixed(2)}
            <span className="text-xs font-normal text-slate-400 ml-1">dS/m</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {soil.salinity_dsm > 1.7 ? '▲ Restricts Corn' : '● Low salinity'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500">Mean Slope</div>
          <div
            className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
              slopeErosionTrigger ? 'text-amber-700' : 'text-slate-900'
            }`}
          >
            {soil.mean_slope_pct.toFixed(1)}
            <span className="text-xs font-normal text-slate-400 ml-1">%</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {slopeErosionTrigger ? '▲ Rye Cover Trigger' : '● Stable grade'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500">SMAP Moisture</div>
          <div
            className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
              smapPenaltyRisk ? 'text-amber-700' : 'text-slate-900'
            }`}
          >
            {soil.smap_rootzone_moisture}
            <span className="text-xs font-normal text-slate-400 ml-1">pct</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {smapPenaltyRisk ? '▲ -20pt Water Penalty' : '● Adequate'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500">Water Regime</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">
            {soil.irrigated ? '● Irrigated' : 'Dryland'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {soil.is_manual_override ? 'Lab Override' : 'USDA Baseline'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500">Elevation</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
            {telemetry.elevation_m}
            <span className="text-xs font-normal text-slate-400 ml-1">m</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">DEM Centroid</div>
        </div>
      </div>

      {/* Multi-Season Soil Organic Matter D3 Line Chart */}
      {omHistory.length >= 2 ? (
        <SoilOmTrendChart history={omHistory} />
      ) : (
        <div className="border-t border-slate-200 px-5 py-3 bg-slate-50/40 text-xs text-slate-500">
          Multi-season Soil Organic Matter trend chart appears once at least 2 seasonal soil samples are stored in the database for {field.name}.
        </div>
      )}

      {/* NASA POWER Climate Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-t border-slate-200 bg-slate-50/40 text-xs">
        <div className="px-4 py-3">
          <div className="text-slate-500">85th-Pct GDD (Base 10°C)</div>
          <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-slate-900">
            {telemetry.gdd_85th_percentile} °C·d
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-slate-500">Frost-Free Window</div>
          <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-slate-900">
            {telemetry.frost_free_days} days
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-slate-500">Annual / Growing Precip</div>
          <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-slate-900">
            {telemetry.annual_precip_mm} / {telemetry.growing_season_precip_mm} mm
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-slate-500">Mean Reference ET₀</div>
          <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-slate-900">
            {telemetry.mean_et0_mm_day.toFixed(2)} mm/day
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-slate-500">ET₀ Computation</div>
          <div className="mt-0.5 text-sm font-medium text-slate-800 truncate">
            {telemetry.et0_method}
          </div>
        </div>
      </div>

      {/* Inline Manual Lab Soil Override Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Manual Lab Soil Override"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Manual Lab Soil Override — {field.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Persists via PUT /api/v1/fields/{field.id}/soil and updates multi-season OM history
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <label className="space-y-1">
                  <span className="font-medium text-slate-700">Soil pH (1:1 H₂O)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="3.5"
                    max="9.5"
                    required
                    value={ph}
                    onChange={(e) => setPh(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-medium text-slate-700">Organic Matter (%)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="30"
                    required
                    value={om}
                    onChange={(e) => setOm(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </label>

                <label className="col-span-2 space-y-1">
                  <span className="font-medium text-slate-700">Soil Texture Class</span>
                  <input
                    type="text"
                    required
                    value={texture}
                    onChange={(e) => setTexture(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-medium text-slate-700">CEC (meq/100g)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    max="80"
                    required
                    value={cec}
                    onChange={(e) => setCec(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-medium text-slate-700">Salinity EC (dS/m)</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="20"
                    required
                    value={salinity}
                    onChange={(e) => setSalinity(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-medium text-slate-700">Mean Slope (%)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="45"
                    required
                    value={slope}
                    onChange={(e) => setSlope(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-medium text-slate-700">SMAP Moisture (0–100 pct)</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    required
                    value={smap}
                    onChange={(e) => setSmap(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={irrigated}
                  onChange={(e) => setIrrigated(e.target.checked)}
                  className="accent-emerald-700"
                />
                Field has active irrigation infrastructure
              </label>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50"
                >
                  {saving ? 'Saving Override...' : 'Save Lab Override & Re-Optimize'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
