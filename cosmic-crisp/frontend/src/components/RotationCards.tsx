'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ShieldAlert, ShieldCheck, Sprout } from 'lucide-react';
import type { RotationGenerateResponse } from '@/lib/api';

interface RotationCardsProps {
  data: RotationGenerateResponse | null;
  loading: boolean;
  offline: boolean;
}

export function RotationCards({ data, loading, offline }: RotationCardsProps) {
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [stage1Open, setStage1Open] = useState(true);

  if (loading) {
    return (
      <section className="border border-slate-200 bg-white rounded-lg p-6 space-y-4">
        <div className="h-5 w-72 bg-slate-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-96 border border-slate-200 rounded-lg bg-slate-50 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="border border-slate-200 bg-white rounded-lg p-8 text-center text-sm text-slate-600">
        Select a field parcel and run the 4-Stage Decision Engine to compute ranked 3-year crop rotation plans.
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Top 3 Ranked 3-Year Rotation Plans
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Prior Crop: {data.previous_crop} · Beam Width: {data.beam_width} ·{' '}
            {data.passing_crops_count} of {data.gate_audit_log.length} crops passed Stage 1 Gates
            {offline ? ' · Loaded from IndexedDB Offline Cache' : ''}
          </p>
        </div>
        <div className="text-xs font-mono tabular-nums text-slate-500">
          TotalScore = 0.30(S_soil) + 0.25(S_pest) + 0.25(S_water) + 0.20(S_econ)
        </div>
      </div>

      {/* Top 3 Ranked Plans Side-by-Side */}
      {data.ranked_plans.length === 0 ? (
        <div className="border border-rose-200 bg-rose-50 rounded-lg p-5 text-sm text-rose-900">
          All candidate crops were eliminated by Stage 1 Hard Agronomic & Climate Gates. Inspect the Stage 1 Gate Audit Log below and adjust soil or irrigation parameters.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
          {data.ranked_plans.map((plan) => {
            const isExpanded = expandedPlanId === plan.plan_id;
            return (
              <article
                key={plan.plan_id}
                className={`border rounded-lg bg-white overflow-hidden flex flex-col ${
                  plan.rank === 1 ? 'border-emerald-600' : 'border-slate-200'
                }`}
              >
                {/* Plan Header */}
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      0{plan.rank}.{' '}
                      {plan.rank === 1
                        ? 'Primary Optimal Plan'
                        : plan.rank === 2
                          ? 'Secondary Diversified Plan'
                          : 'Tertiary Alternative Plan'}
                    </h3>
                    <span className="font-mono tabular-nums text-base font-bold text-emerald-700">
                      {plan.composite_3yr_score.toFixed(1)}
                      <span className="text-xs font-normal text-slate-400">/100</span>
                    </span>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-mono tabular-nums pt-2 border-t border-slate-200/80">
                    <div>
                      <div className="text-slate-500">3-Yr Margin</div>
                      <div className="font-semibold text-slate-900">
                        ${plan.cumulative_3yr_net_margin_usd_acre.toFixed(0)}/ac
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Net N Bal</div>
                      <div className="font-semibold text-slate-900">
                        {plan.cumulative_3yr_n_balance_lbs_acre >= 0 ? '+' : ''}
                        {plan.cumulative_3yr_n_balance_lbs_acre.toFixed(0)} lb
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">N Savings</div>
                      <div className="font-semibold text-emerald-700">
                        ${plan.total_fertilizer_savings_usd_acre.toFixed(0)}/ac
                      </div>
                    </div>
                  </div>
                </div>

                {/* Yearly Crop Cards */}
                <div className="divide-y divide-slate-200">
                  {plan.steps.map((step) => (
                    <div key={`${plan.plan_id}-${step.year_index}`} className="p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-medium text-slate-700">{step.season_label}</span>
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          {step.total_score.toFixed(1)} / 100
                        </span>
                      </div>

                      <div>
                        <div className="text-sm font-semibold text-slate-900">{step.crop_name}</div>
                        <div className="text-xs text-slate-500">
                          {step.botanical_family} · Margin ${step.net_margin_usd_acre.toFixed(0)}/ac
                        </div>
                      </div>

                      {step.overwinter_cover_crops.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          {step.overwinter_cover_crops.map((cov) => (
                            <div
                              key={cov.crop_id}
                              className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-md text-xs text-emerald-900"
                            >
                              <div className="flex items-center gap-1.5 font-semibold">
                                <Sprout className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                <span>Overwinter Cover: {cov.crop_name}</span>
                              </div>
                              <p className="text-emerald-800 mt-0.5 leading-snug">
                                {cov.trigger_reason}
                                {cov.n_credit_lbs_acre > 0
                                  ? ` · +${cov.n_credit_lbs_acre} lbs N/ac`
                                  : ` · -${cov.erosion_reduction_pct}% erosion`}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Expandable Stage 2 & Stage 3 Score Breakdown */}
                <div className="border-t border-slate-200 bg-slate-50/50">
                  <button
                    type="button"
                    onClick={() => setExpandedPlanId(isExpanded ? null : plan.plan_id)}
                    className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-slate-700 hover:text-slate-900"
                  >
                    <span>Stage 2–3 Agronomic & Telemetry Audit</span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-slate-200 pt-3 text-xs">
                      <div className="grid grid-cols-2 gap-2 font-mono tabular-nums text-slate-700">
                        <div>Avg S_soil (30%): {plan.avg_s_soil.toFixed(1)}</div>
                        <div>Avg S_pest (25%): {plan.avg_s_pest.toFixed(1)}</div>
                        <div>Avg S_water (25%): {plan.avg_s_water.toFixed(1)}</div>
                        <div>Avg S_econ (20%): {plan.avg_s_econ.toFixed(1)}</div>
                      </div>

                      <div className="space-y-2">
                        {plan.steps.map((step) => (
                          <div
                            key={`audit-${plan.plan_id}-${step.year_index}`}
                            className="p-2.5 bg-white border border-slate-200 rounded space-y-1"
                          >
                            <div className="flex justify-between font-medium text-slate-900">
                              <span>
                                Yr {step.year_index}: {step.crop_name}
                              </span>
                              <span className="font-mono tabular-nums">
                                B={step.baseline_transition_score}
                              </span>
                            </div>
                            <div className="font-mono tabular-nums text-slate-600">
                              Soil {step.s_soil} · Pest {step.s_pest} · Water {step.s_water} · Econ{' '}
                              {step.s_econ}
                            </div>
                            <div className="text-slate-500">
                              {step.rationale}
                              {step.legume_n_credit_applied_lbs_acre > 0
                                ? ` · N Credit +${step.legume_n_credit_applied_lbs_acre} lb/ac`
                                : ''}
                              {step.smap_penalty_applied > 0
                                ? ` · SMAP Penalty -${step.smap_penalty_applied} pt`
                                : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Expandable Stage 1 Gate Audit Log */}
      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setStage1Open((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 text-left"
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Stage 1 Hard Agronomic & Climate Gate Audit Log
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Boolean elimination across Soil pH, Salinity, 85th-Pct GDD, Frost-Free (+14d buffer), and Botanical Disease-Break gates
            </p>
          </div>
          {stage1Open ? (
            <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
          )}
        </button>

        {stage1Open && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-4 font-semibold">Candidate Crop</th>
                  <th className="py-2.5 px-3 font-semibold">Gate Result</th>
                  <th className="py-2.5 px-3 font-semibold">pH Gate</th>
                  <th className="py-2.5 px-3 font-semibold">Salinity Gate</th>
                  <th className="py-2.5 px-3 font-semibold">GDD Gate</th>
                  <th className="py-2.5 px-3 font-semibold">Frost-Free</th>
                  <th className="py-2.5 px-3 font-semibold">Disease Break</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.gate_audit_log.map((row) => (
                  <tr key={row.crop_id}>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{row.crop_name}</div>
                      <div className="text-slate-500">{row.botanical_family}</div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {row.passed ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                          <ShieldCheck className="w-3.5 h-3.5" /> Passed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-rose-700">
                          <ShieldAlert className="w-3.5 h-3.5" /> Eliminated
                        </span>
                      )}
                    </td>
                    {(['ph_gate', 'salinity_gate', 'gdd_gate', 'frost_free_gate', 'disease_break_gate'] as const).map(
                      (gateKey) => {
                        const gate = row.gates[gateKey];
                        return (
                          <td
                            key={gateKey}
                            className={`py-2.5 px-3 font-mono tabular-nums ${
                              gate?.passed ? 'text-slate-700' : 'text-rose-700 font-semibold'
                            }`}
                          >
                            {gate ? `${gate.passed ? '● ' : '✖ '}${gate.detail}` : '—'}
                          </td>
                        );
                      }
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
