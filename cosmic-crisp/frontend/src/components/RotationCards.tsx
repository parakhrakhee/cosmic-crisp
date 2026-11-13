'use client';

import React from 'react';
import { Sprout, ShieldCheck, ShieldAlert } from 'lucide-react';

export interface RotationResponse {
  field_id: string;
  field_name: string;
  beam_width: number;
  previous_crop: string;
  passing_crops_count: number;
  gate_audit_log: Array<{
    crop_id: string;
    crop_name: string;
    botanical_family: string;
    passed: boolean;
    rejection_reasons: string[];
  }>;
  ranked_plans: Array<{
    rank: number;
    plan_id: string;
    composite_3yr_score: number;
    avg_s_soil: number;
    avg_s_pest: number;
    avg_s_water: number;
    avg_s_econ: number;
    cumulative_3yr_net_margin_usd_acre: number;
    cumulative_3yr_n_balance_lbs_acre: number;
    steps: Array<{
      year_index: number;
      season_label: string;
      crop_name: string;
      botanical_family: string;
      total_score: number;
      s_soil: number;
      s_pest: number;
      s_water: number;
      s_econ: number;
      net_margin_usd_acre: number;
      rationale: string;
      overwinter_cover_crops: Array<{
        crop_id: string;
        crop_name: string;
        trigger_reason: string;
      }>;
    }>;
  }>;
}

export function RotationCards({ data }: { data: RotationResponse | null }) {
  if (!data) {
    return (
      <div className="border border-slate-200 bg-white rounded-lg p-6 text-sm text-slate-600">
        Select or create a field to generate 3-year crop rotation plans.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.ranked_plans.map((plan) => (
        <article key={plan.plan_id} className="border border-slate-200 bg-white rounded-lg overflow-hidden">
          <div className="flex flex-wrap items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
            <div className="text-sm font-semibold text-slate-900">
              0{plan.rank}. {plan.steps.map((s) => s.crop_name).join(' → ')}
            </div>
            <div className="text-xs font-mono space-x-4">
              <span>Score: {plan.composite_3yr_score.toFixed(1)}/100</span>
              <span>3-Yr Margin: ${plan.cumulative_3yr_net_margin_usd_acre.toFixed(0)}/ac</span>
              <span>N Balance: {plan.cumulative_3yr_n_balance_lbs_acre.toFixed(0)} lbs/ac</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200">
            {plan.steps.map((step) => (
              <div key={step.year_index} className="p-4 space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{step.season_label}</span>
                  <span className="font-mono font-semibold text-slate-900">{step.total_score.toFixed(1)}</span>
                </div>
                <div className="text-base font-semibold text-slate-900">{step.crop_name}</div>
                <div className="text-xs text-slate-600">{step.rationale}</div>
                {step.overwinter_cover_crops.map((cov) => (
                  <div key={cov.crop_id} className="p-2.5 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-900">
                    <div className="flex items-center gap-1 font-semibold">
                      <Sprout className="w-3.5 h-3.5" />
                      {cov.crop_name}
                    </div>
                    <p className="mt-0.5">{cov.trigger_reason}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </article>
      ))}

      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 text-sm font-semibold">
          Stage 1 Gate Audit Log
        </div>
        <div className="divide-y divide-slate-200 text-xs">
          {data.gate_audit_log.map((g) => (
            <div key={g.crop_id} className="px-5 py-2.5 flex items-center justify-between gap-4">
              <span className="font-medium text-slate-900">{g.crop_name} ({g.botanical_family})</span>
              {g.passed ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" /> Passed All Gates
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-rose-700">
                  <ShieldAlert className="w-3.5 h-3.5" /> {g.rejection_reasons.join('; ')}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
