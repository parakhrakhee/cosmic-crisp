import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ShieldCheck, ShieldAlert, Sprout } from 'lucide-react';
import type { RotationGenerationResponse } from '../types';

interface RotationCardsProps {
  rotationData: RotationGenerationResponse | null;
  loading: boolean;
  fromOfflineCache: boolean;
}

export const RotationCards: React.FC<RotationCardsProps> = ({
  rotationData,
  loading,
  fromOfflineCache,
}) => {
  const [auditOpen, setAuditOpen] = useState(true);

  if (loading) {
    return (
      <section className="border border-slate-200 bg-white rounded-lg p-6 space-y-4">
        <div className="h-5 w-64 bg-slate-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 border border-slate-200 rounded-lg bg-slate-50 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (!rotationData) {
    return (
      <section className="border border-slate-200 bg-white rounded-lg p-8 text-center">
        <p className="text-sm font-medium text-slate-800">
          Select a field parcel and run the 4-Stage Decision Engine to compute ranked 3-year crop rotations.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* Ranked Top 3 Plans */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Top 3 Ranked 3-Year Rotation Plans
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Prior Crop: {rotationData.previous_crop} · Beam Search Width: {rotationData.beam_width} ·{' '}
              {rotationData.passing_crops_count} of {rotationData.gate_audit_log.length} crop groups passed Stage 1 Gates
              {fromOfflineCache ? ' · Loaded from IndexedDB Offline Cache' : ''}
            </p>
          </div>
          <div className="text-xs font-mono text-slate-500 tabular-nums">
            TotalScore = 0.30(S_soil) + 0.25(S_pest) + 0.25(S_water) + 0.20(S_econ)
          </div>
        </div>

        {rotationData.ranked_plans.length === 0 ? (
          <div className="border border-rose-200 bg-rose-50 rounded-lg p-5 text-sm text-rose-900">
            All candidate cash crops were eliminated by Stage 1 Hard Agronomic & Climate Gates. Review the Gate Audit Log below and adjust soil pH, salinity, or irrigation parameters.
          </div>
        ) : (
          <div className="space-y-4">
            {rotationData.ranked_plans.map((plan) => (
              <article
                key={plan.plan_id}
                className={`border rounded-lg bg-white overflow-hidden ${
                  plan.rank === 1 ? 'border-emerald-600' : 'border-slate-200'
                }`}
              >
                {/* Plan Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
                  <div className="flex items-baseline gap-3">
                    <span className="text-sm font-semibold text-slate-900">
                      0{plan.rank}.{' '}
                      {plan.rank === 1
                        ? 'Primary Optimal Sequence'
                        : plan.rank === 2
                          ? 'Secondary Diversified Sequence'
                          : 'Tertiary Alternative Sequence'}
                    </span>
                    <span className="text-xs text-slate-500">
                      {plan.steps.map((s) => s.crop_name.split(' ')[0]).join(' → ')}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-6 text-xs font-mono tabular-nums">
                    <div>
                      <span className="text-slate-500 mr-1.5">Composite</span>
                      <span className="text-base font-bold text-emerald-700">
                        {plan.composite_3yr_score.toFixed(1)}
                      </span>
                      <span className="text-slate-400">/100</span>
                    </div>
                    <div>
                      <span className="text-slate-500 mr-1.5">3-Yr Margin</span>
                      <span className="font-semibold text-slate-900">
                        ${plan.cumulative_3yr_net_margin_usd_acre.toFixed(0)}/ac
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 mr-1.5">Net N Bal</span>
                      <span
                        className={`font-semibold ${
                          plan.cumulative_3yr_n_balance_lbs_acre >= 0
                            ? 'text-emerald-700'
                            : 'text-slate-900'
                        }`}
                      >
                        {plan.cumulative_3yr_n_balance_lbs_acre >= 0 ? '+' : ''}
                        {plan.cumulative_3yr_n_balance_lbs_acre.toFixed(0)} lbs/ac
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 mr-1.5">N Savings</span>
                      <span className="font-semibold text-emerald-700">
                        ${plan.total_fertilizer_savings_usd_acre.toFixed(0)}/ac
                      </span>
                    </div>
                  </div>
                </div>

                {/* Sub-score Strip */}
                <div className="grid grid-cols-4 divide-x divide-slate-200 border-b border-slate-200 text-xs bg-white">
                  <div className="px-5 py-2 flex items-center justify-between">
                    <span className="text-slate-500">Soil Health (30%)</span>
                    <span className="font-mono font-semibold tabular-nums text-slate-900">
                      {plan.avg_s_soil.toFixed(1)}
                    </span>
                  </div>
                  <div className="px-5 py-2 flex items-center justify-between">
                    <span className="text-slate-500">Pest Break (25%)</span>
                    <span className="font-mono font-semibold tabular-nums text-slate-900">
                      {plan.avg_s_pest.toFixed(1)}
                    </span>
                  </div>
                  <div className="px-5 py-2 flex items-center justify-between">
                    <span className="text-slate-500">Water Fit (25%)</span>
                    <span className="font-mono font-semibold tabular-nums text-slate-900">
                      {plan.avg_s_water.toFixed(1)}
                    </span>
                  </div>
                  <div className="px-5 py-2 flex items-center justify-between">
                    <span className="text-slate-500">Net Economics (20%)</span>
                    <span className="font-mono font-semibold tabular-nums text-slate-900">
                      {plan.avg_s_econ.toFixed(1)}
                    </span>
                  </div>
                </div>

                {/* Year-by-Year Steps */}
                <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
                  {plan.steps.map((step) => (
                    <div key={`${plan.plan_id}-${step.year_index}`} className="p-5 flex flex-col justify-between gap-3">
                      <div>
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="font-medium text-slate-700">{step.season_label}</span>
                          <span className="font-mono tabular-nums font-semibold text-slate-900">
                            Score {step.total_score.toFixed(1)}
                          </span>
                        </div>

                        <h3 className="mt-1.5 text-base font-semibold text-slate-900">
                          {step.crop_name}
                        </h3>
                        <p className="text-xs text-slate-500">
                          {step.botanical_family} · Matrix Baseline {step.baseline_transition_score}/100
                        </p>

                        <p className="mt-2.5 text-xs text-slate-600 leading-relaxed">
                          {step.rationale}
                        </p>

                        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono tabular-nums text-slate-700 pt-2.5 border-t border-slate-100">
                          <div>S_soil: {step.s_soil.toFixed(0)}</div>
                          <div>S_pest: {step.s_pest.toFixed(0)}</div>
                          <div>S_water: {step.s_water.toFixed(0)}</div>
                          <div>S_econ: {step.s_econ.toFixed(0)}</div>
                          <div>Margin: ${step.net_margin_usd_acre.toFixed(0)}/ac</div>
                          <div>
                            2Yr N: {step.cumulative_2yr_n_balance_lbs_acre >= 0 ? '+' : ''}
                            {step.cumulative_2yr_n_balance_lbs_acre.toFixed(0)} lb
                          </div>
                        </div>
                      </div>

                      {step.overwinter_cover_crops.length > 0 && (
                        <div className="mt-2 p-3 bg-emerald-50/70 border border-emerald-200 rounded-md space-y-1.5">
                          {step.overwinter_cover_crops.map((cov) => (
                            <div key={cov.crop_id} className="text-xs">
                              <div className="flex items-center gap-1.5 font-semibold text-emerald-900">
                                <Sprout className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                <span>Overwinter Injection: {cov.crop_name}</span>
                              </div>
                              <p className="text-emerald-800 mt-0.5 leading-snug">
                                {cov.trigger_reason}
                                {cov.n_credit_lbs_acre > 0
                                  ? ` · +${cov.n_credit_lbs_acre} lbs N/ac credit`
                                  : ` · -${cov.erosion_reduction_pct}% winter erosion`}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Stage 1 Gate Audit Log */}
      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setAuditOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 text-left cursor-pointer"
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Stage 1 Hard Agronomic & Climate Gate Audit Log
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Deterministic Boolean gate verification for soil pH, salinity, 85th-percentile GDD, frost-free buffer (+14d), and botanical disease-break rules
            </p>
          </div>
          {auditOpen ? (
            <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
          )}
        </button>

        {auditOpen && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-4 font-semibold">Candidate Crop</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">pH Gate</th>
                  <th className="py-2.5 px-3 font-semibold">Salinity Gate</th>
                  <th className="py-2.5 px-3 font-semibold">GDD Gate</th>
                  <th className="py-2.5 px-3 font-semibold">Frost-Free (+14d)</th>
                  <th className="py-2.5 px-3 font-semibold">Disease-Break Gate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rotationData.gate_audit_log.map((row) => (
                  <tr key={row.crop_id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{row.crop_name}</div>
                      <div className="text-slate-500">{row.botanical_family}</div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {row.passed ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Passed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-rose-700">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          Eliminated
                        </span>
                      )}
                    </td>
                    <td className={`py-2.5 px-3 font-mono tabular-nums ${row.gates.ph_gate.passed ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>
                      {row.gates.ph_gate.passed ? '● ' : '✖ '}
                      {row.gates.ph_gate.detail}
                    </td>
                    <td className={`py-2.5 px-3 font-mono tabular-nums ${row.gates.salinity_gate.passed ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>
                      {row.gates.salinity_gate.passed ? '● ' : '✖ '}
                      {row.gates.salinity_gate.detail}
                    </td>
                    <td className={`py-2.5 px-3 font-mono tabular-nums ${row.gates.gdd_gate.passed ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>
                      {row.gates.gdd_gate.passed ? '● ' : '✖ '}
                      {row.gates.gdd_gate.detail}
                    </td>
                    <td className={`py-2.5 px-3 font-mono tabular-nums ${row.gates.frost_free_gate.passed ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>
                      {row.gates.frost_free_gate.passed ? '● ' : '✖ '}
                      {row.gates.frost_free_gate.detail}
                    </td>
                    <td className={`py-2.5 px-3 ${row.gates.disease_break_gate.passed ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>
                      {row.gates.disease_break_gate.passed ? '● ' : '✖ '}
                      {row.gates.disease_break_gate.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
