import React, { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import type { FieldRecord } from '../types';

interface SoilAuditCardProps {
  field: FieldRecord;
  onSaveOverride: (
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
  ) => Promise<void>;
}

export const SoilAuditCard: React.FC<SoilAuditCardProps> = ({ field, onSaveOverride }) => {
  const { soil } = field;
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
        mean_slope_pct: Number(slope) || 1.5,
        smap_rootzone_moisture: Number(smap) || 45,
        irrigated,
      });
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const smapPenaltyRisk = soil.smap_rootzone_moisture < 30 && !soil.irrigated;
  const slopeErosionTrigger = soil.mean_slope_pct > 5.0;

  return (
    <section className="border border-slate-200 bg-white rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Soil Chemistry, Topography & Root-Zone Moisture Audit
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Source: {soil.source}
            {soil.mukey ? ` · Map Unit ${soil.mukey}` : ''} · Updated{' '}
            {new Date(soil.updated_at).toLocaleDateString()}
          </p>
        </div>

        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
          Override Lab Soil Test
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
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
          <div className="text-xs text-slate-400 mt-0.5">Surface horizon</div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500">CEC</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
            {soil.cec_meq.toFixed(1)}
            <span className="text-xs font-normal text-slate-400 ml-1">meq</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">meq/100g</div>
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
            {smapPenaltyRisk ? '▲ -20pt Dryland Risk' : '● Adequate'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500">Irrigation</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">
            {soil.irrigated ? '● Irrigated' : 'Dryland (Rainfed)'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {soil.is_manual_override ? 'Lab Override Active' : 'Baseline Config'}
          </div>
        </div>
      </div>

      {/* Lab Soil Override Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[1200] bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Manual Lab Soil Override"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Manual Lab Soil Test Override
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Overrides USDA NRCS SSURGO defaults for {field.name} via PUT /api/v1/fields/{field.id}/soil
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Soil pH (1:1 H₂O)
                  </label>
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
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Organic Matter (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="25"
                    required
                    value={om}
                    onChange={(e) => setOm(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Soil Texture Class
                  </label>
                  <input
                    type="text"
                    required
                    value={texture}
                    onChange={(e) => setTexture(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    CEC (meq/100g)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    max="60"
                    required
                    value={cec}
                    onChange={(e) => setCec(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Salinity EC (dS/m)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="15"
                    required
                    value={salinity}
                    onChange={(e) => setSalinity(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mean Slope (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="35"
                    required
                    value={slope}
                    onChange={(e) => setSlope(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    SMAP Root-Zone Moisture (0–100 pct)
                  </label>
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
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer pt-1">
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
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
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
};
