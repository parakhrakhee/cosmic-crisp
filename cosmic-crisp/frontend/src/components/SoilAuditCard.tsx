'use client';

import React, { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';

export interface SoilProfileData {
  ph: number;
  organic_matter_pct: number;
  soil_texture: string;
  cec_meq: number;
  salinity_dsm: number;
  mean_slope_pct: number;
  smap_rootzone_moisture: number;
  irrigated: boolean;
  source: string;
  is_manual_override: boolean;
}

interface SoilAuditCardProps {
  fieldId: string;
  fieldName: string;
  soil: SoilProfileData;
  onSaveOverride: (fieldId: string, payload: Omit<SoilProfileData, 'source' | 'is_manual_override'>) => Promise<void>;
}

export function SoilAuditCard({ fieldId, fieldName, soil, onSaveOverride }: SoilAuditCardProps) {
  const [open, setOpen] = useState(false);
  const [ph, setPh] = useState(soil.ph.toString());
  const [om, setOm] = useState(soil.organic_matter_pct.toString());
  const [texture, setTexture] = useState(soil.soil_texture);
  const [cec, setCec] = useState(soil.cec_meq.toString());
  const [salinity, setSalinity] = useState(soil.salinity_dsm.toString());
  const [slope, setSlope] = useState(soil.mean_slope_pct.toString());
  const [smap, setSmap] = useState(soil.smap_rootzone_moisture.toString());
  const [irrigated, setIrrigated] = useState(soil.irrigated);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveOverride(fieldId, {
        ph: Number(ph),
        organic_matter_pct: Number(om),
        soil_texture: texture,
        cec_meq: Number(cec),
        salinity_dsm: Number(salinity),
        mean_slope_pct: Number(slope),
        smap_rootzone_moisture: Number(smap),
        irrigated,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border border-slate-200 bg-white rounded-lg">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Soil & Hydrology Profile</h2>
          <p className="text-xs text-slate-500">Source: {soil.source}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Override Lab Soil Test
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-x divide-slate-200 text-xs">
        <div className="p-4"><div className="text-slate-500">pH</div><div className="text-lg font-mono font-semibold">{soil.ph.toFixed(1)}</div></div>
        <div className="p-4"><div className="text-slate-500">OM %</div><div className="text-lg font-mono font-semibold">{soil.organic_matter_pct.toFixed(1)}%</div></div>
        <div className="p-4"><div className="text-slate-500">Texture</div><div className="text-sm font-semibold">{soil.soil_texture}</div></div>
        <div className="p-4"><div className="text-slate-500">CEC</div><div className="text-lg font-mono font-semibold">{soil.cec_meq.toFixed(1)}</div></div>
        <div className="p-4"><div className="text-slate-500">Salinity</div><div className="text-lg font-mono font-semibold">{soil.salinity_dsm.toFixed(2)} dS/m</div></div>
        <div className="p-4"><div className="text-slate-500">Slope</div><div className="text-lg font-mono font-semibold">{soil.mean_slope_pct.toFixed(1)}%</div></div>
        <div className="p-4"><div className="text-slate-500">SMAP</div><div className="text-lg font-mono font-semibold">{soil.smap_rootzone_moisture} pct</div></div>
        <div className="p-4"><div className="text-slate-500">Regime</div><div className="text-sm font-semibold">{soil.irrigated ? 'Irrigated' : 'Dryland'}</div></div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-lg w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Manual Soil Lab Override — {fieldName}</h3>
              <button type="button" onClick={() => setOpen(false)}><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1"><span>pH</span><input type="number" step="0.1" value={ph} onChange={(e) => setPh(e.target.value)} className="w-full px-2.5 py-1.5 border rounded" /></label>
              <label className="space-y-1"><span>OM (%)</span><input type="number" step="0.1" value={om} onChange={(e) => setOm(e.target.value)} className="w-full px-2.5 py-1.5 border rounded" /></label>
              <label className="col-span-2 space-y-1"><span>Texture</span><input type="text" value={texture} onChange={(e) => setTexture(e.target.value)} className="w-full px-2.5 py-1.5 border rounded" /></label>
              <label className="space-y-1"><span>CEC (meq)</span><input type="number" step="0.1" value={cec} onChange={(e) => setCec(e.target.value)} className="w-full px-2.5 py-1.5 border rounded" /></label>
              <label className="space-y-1"><span>Salinity (dS/m)</span><input type="number" step="0.05" value={salinity} onChange={(e) => setSalinity(e.target.value)} className="w-full px-2.5 py-1.5 border rounded" /></label>
              <label className="space-y-1"><span>Slope (%)</span><input type="number" step="0.1" value={slope} onChange={(e) => setSlope(e.target.value)} className="w-full px-2.5 py-1.5 border rounded" /></label>
              <label className="space-y-1"><span>SMAP (%)</span><input type="number" value={smap} onChange={(e) => setSmap(e.target.value)} className="w-full px-2.5 py-1.5 border rounded" /></label>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={irrigated} onChange={(e) => setIrrigated(e.target.checked)} />
              Irrigated Field
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs border rounded">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-1.5 text-xs text-white bg-emerald-700 rounded">
                {saving ? 'Saving...' : 'Save Override'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
