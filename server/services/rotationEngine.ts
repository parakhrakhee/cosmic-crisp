import { COMPATIBILITY_MATRIX, CROP_SPECS, PRIMARY_CROP_IDS } from '../seedData';
import type {
  CropSpec,
  FieldRecord,
  GateAuditEntry,
  InjectedCoverCrop,
  RankedRotationPlan,
  RotationGenerationResponse,
  YearPlanStep,
} from '../types';

const N_FERTILIZER_PRICE_PER_LB = 0.68;

function getCropById(cropId: string): CropSpec {
  const found = CROP_SPECS.find((c) => c.id === cropId);
  if (!found) {
    throw new Error(`Unknown crop ID: ${cropId}`);
  }
  return found;
}

/**
 * STAGE 1: Hard Agronomic & Climate Gates (Boolean Elimination)
 */
export function runStage1Gates(
  field: FieldRecord,
  historyRecentFirst: string[]
): { passingCrops: CropSpec[]; gateAuditLog: GateAuditEntry[] } {
  const candidates = CROP_SPECS.filter((c) => !c.is_cover_crop);
  const passingCrops: CropSpec[] = [];
  const gateAuditLog: GateAuditEntry[] = [];

  for (const crop of candidates) {
    const phOk = field.soil.ph >= crop.ph_min && field.soil.ph <= crop.ph_max;
    const salinityOk = field.soil.salinity_dsm <= crop.max_salinity_dsm;
    const gddOk = field.telemetry.gdd_85th_percentile >= crop.gdd_required;
    const frostOk = field.telemetry.frost_free_days >= crop.frost_free_days_min + 14;

    // Botanical Disease-Break Gate: check if crop appeared within min_rotation_break_years
    let breakOk = true;
    let breakDetail = `No break conflict (min ${crop.min_rotation_break_years} yr break)`;
    if (crop.min_rotation_break_years > 0) {
      const windowSlice = historyRecentFirst.slice(0, crop.min_rotation_break_years);
      const conflictIdx = windowSlice.indexOf(crop.id);
      if (conflictIdx !== -1) {
        breakOk = false;
        const yearsAgo = conflictIdx + 1;
        breakDetail = `Blocked: grown ${yearsAgo} yr ago; requires ${crop.min_rotation_break_years}-yr botanical disease break`;
      }
    }

    const rejectionReasons: string[] = [];
    if (!phOk) {
      rejectionReasons.push(
        `Soil pH ${field.soil.ph.toFixed(1)} outside tolerance [${crop.ph_min.toFixed(1)}–${crop.ph_max.toFixed(1)}]`
      );
    }
    if (!salinityOk) {
      rejectionReasons.push(
        `Salinity ${field.soil.salinity_dsm.toFixed(2)} dS/m exceeds max ${crop.max_salinity_dsm.toFixed(2)} dS/m`
      );
    }
    if (!gddOk) {
      rejectionReasons.push(
        `85th-pct GDD ${field.telemetry.gdd_85th_percentile} °C·d below required ${crop.gdd_required} °C·d`
      );
    }
    if (!frostOk) {
      rejectionReasons.push(
        `Frost-free ${field.telemetry.frost_free_days}d below required ${crop.frost_free_days_min + 14}d (${crop.frost_free_days_min}d + 14d buffer)`
      );
    }
    if (!breakOk) {
      rejectionReasons.push(breakDetail);
    }

    const passed = phOk && salinityOk && gddOk && frostOk && breakOk;
    if (passed) {
      passingCrops.push(crop);
    }

    gateAuditLog.push({
      crop_id: crop.id,
      crop_name: crop.name,
      botanical_family: crop.botanical_family,
      passed,
      gates: {
        ph_gate: {
          passed: phOk,
          detail: `Field pH ${field.soil.ph.toFixed(1)} vs [${crop.ph_min.toFixed(1)}–${crop.ph_max.toFixed(1)}]`,
        },
        salinity_gate: {
          passed: salinityOk,
          detail: `${field.soil.salinity_dsm.toFixed(2)} dS/m <= ${crop.max_salinity_dsm.toFixed(2)} dS/m`,
        },
        gdd_gate: {
          passed: gddOk,
          detail: `${field.telemetry.gdd_85th_percentile} >= ${crop.gdd_required} °C·d`,
        },
        frost_free_gate: {
          passed: frostOk,
          detail: `${field.telemetry.frost_free_days}d >= ${crop.frost_free_days_min + 14}d`,
        },
        disease_break_gate: {
          passed: breakOk,
          detail: breakDetail,
        },
      },
      rejection_reasons: rejectionReasons,
    });
  }

  return { passingCrops, gateAuditLog };
}

/**
 * Check disease-break dynamically during Year 2 & Year 3 of Beam Search
 */
function passesDiseaseBreakForSequence(
  candidate: CropSpec,
  historyRecentFirst: string[]
): boolean {
  if (candidate.min_rotation_break_years <= 0) return true;
  const recentWindow = historyRecentFirst.slice(0, candidate.min_rotation_break_years);
  return !recentWindow.includes(candidate.id);
}

/**
 * STAGE 2 & STAGE 3: Transition Matrix Lookup, Telemetry Modifiers & Multi-Objective Scoring
 */
function evaluateCandidateStep(params: {
  field: FieldRecord;
  candidate: CropSpec;
  prevCropId: string;
  historyRecentFirst: string[];
  prevInjectedCoverN: number;
  prev2YrNetN: number;
  yearIndex: number;
}): YearPlanStep {
  const {
    field,
    candidate,
    prevCropId,
    historyRecentFirst,
    prevInjectedCoverN,
    prev2YrNetN,
    yearIndex,
  } = params;

  const prevCrop = getCropById(prevCropId);
  const baselineMatrix = COMPATIBILITY_MATRIX[prevCropId]?.[candidate.id] ?? 60;

  // Stage 2A: Legume Residual Nitrogen Credit (+15 to +45 lbs/acre)
  const rawLegumeCredit = prevCrop.is_legume
    ? prevCrop.n_credit_provided_lbs_acre
    : 0;
  const totalAvailableCredit = rawLegumeCredit + prevInjectedCoverN;
  // Credit only offsets nitrogen fertilizer required by the candidate crop
  const appliedNCredit = Math.min(candidate.fertilizer_n_req_lbs_acre, totalAvailableCredit);
  const fertilizerSavings = Number((appliedNCredit * N_FERTILIZER_PRICE_PER_LB).toFixed(2));

  // S_soil (30%): matrix compatibility + root alternation + N credit benefit + slope erosion check
  const rootAlternationBonus = candidate.root_type !== prevCrop.root_type ? 10 : -8;
  const slopeErosionAdj =
    field.soil.mean_slope_pct > 5
      ? (candidate.erosion_protection_score - 60) * 0.25
      : (candidate.erosion_protection_score - 55) * 0.08;
  const nCreditSoilBoost = !candidate.is_legume && appliedNCredit >= 15 ? 8 : candidate.is_legume ? 6 : 0;
  const sSoil = clampScore(
    baselineMatrix * 0.85 + rootAlternationBonus + slopeErosionAdj + nCreditSoilBoost + 5
  );

  // S_pest (25%): Botanical family rotation distance
  // same family back-to-back = 0, 1-year break = 50, >=2-year break = 90-100
  const lastFamily1 = historyRecentFirst[0] ? getCropById(historyRecentFirst[0]).botanical_family : null;
  const lastFamily2 = historyRecentFirst[1] ? getCropById(historyRecentFirst[1]).botanical_family : null;
  let sPest = 95;
  if (lastFamily1 === candidate.botanical_family) {
    sPest = 0;
  } else if (lastFamily2 === candidate.botanical_family) {
    sPest = 50;
  } else {
    sPest = candidate.id === 'canola' || candidate.id === 'winter_wheat' ? 98 : 94;
  }

  // Stage 2B & S_water (25%): Water demand vs NASA POWER precip + SMAP moisture + irrigation
  const effectiveWaterSupply = field.soil.irrigated
    ? Math.max(field.telemetry.growing_season_precip_mm, candidate.water_demand_mm)
    : field.telemetry.growing_season_precip_mm + (field.soil.smap_rootzone_moisture - 40) * 2.5;
  const waterRatio = effectiveWaterSupply / Math.max(1, candidate.water_demand_mm);
  let sWaterBase: number;
  if (waterRatio >= 1.0) {
    sWaterBase = 92;
  } else if (waterRatio >= 0.78) {
    sWaterBase = 76 + (waterRatio - 0.78) * 70;
  } else {
    sWaterBase = Math.max(20, waterRatio * 90);
  }
  const smapPenalty =
    field.soil.smap_rootzone_moisture < 30 &&
    !field.soil.irrigated &&
    candidate.water_demand_mm >= 550
      ? 20
      : 0;
  const sWater = clampScore(sWaterBase - smapPenalty);

  // S_econ (20%): (Projected Yield * Regional Price) - (Seed + Net Fertilizer Cost after N-Credit + Irrigation Cost)
  const projectedRevenue = Number(
    (candidate.projected_yield_units_acre * candidate.regional_price_per_unit).toFixed(2)
  );
  const netFertilizerLbs = Math.max(0, candidate.fertilizer_n_req_lbs_acre - appliedNCredit);
  const netFertCost = netFertilizerLbs * N_FERTILIZER_PRICE_PER_LB;
  const irrigationCost = field.soil.irrigated ? candidate.base_irrigation_cost_per_acre : 0;
  const otherOpsCost = 145; // Tillage, harvest, crop protection baseline ($/ac)
  const projectedCost = Number(
    (candidate.seed_cost_per_acre + netFertCost + irrigationCost + otherOpsCost).toFixed(2)
  );
  const netMargin = Number((projectedRevenue - projectedCost).toFixed(2));
  // Normalize margin (-50 to +550 $/ac) onto 0-100 scale
  const sEcon = clampScore(((netMargin + 50) / 600) * 100);

  // Stage 3 Weighted Composite
  const totalScore = Number(
    (0.30 * sSoil + 0.25 * sPest + 0.25 * sWater + 0.20 * sEcon).toFixed(1)
  );

  // Stage 4: Overwinter Cover Crop Injection Check (between Year t and Year t+1)
  const netNThisYear = candidate.n_balance_lbs_acre + appliedNCredit * 0.35;
  const cumulative2YrN = Number((prev2YrNetN + netNThisYear).toFixed(1));
  const overwinterCovers: InjectedCoverCrop[] = [];

  if (yearIndex < 3) {
    if (cumulative2YrN < -40 && !candidate.is_legume) {
      overwinterCovers.push({
        crop_id: 'crimson_clover',
        crop_name: 'Crimson Clover',
        trigger_reason: `2-year N balance (${cumulative2YrN.toFixed(0)} lbs/ac) < -40 lbs/ac with no legume cash crop`,
        n_credit_lbs_acre: 45,
        erosion_reduction_pct: 32,
      });
    }
    if (field.soil.mean_slope_pct > 5.0) {
      overwinterCovers.push({
        crop_id: 'winter_cereal_rye',
        crop_name: 'Winter Cereal Rye',
        trigger_reason: `Field mean slope (${field.soil.mean_slope_pct.toFixed(1)}%) > 5.0% erosion threshold`,
        n_credit_lbs_acre: 0,
        erosion_reduction_pct: 58,
      });
    }
  }

  const rationaleParts: string[] = [
    `Matrix B(${prevCrop.name.split(' ')[0]} → ${candidate.name.split(' ')[0]}) = ${baselineMatrix}`,
  ];
  if (appliedNCredit > 0) {
    rationaleParts.push(`+${appliedNCredit} lbs/ac legume N credit (-$${fertilizerSavings.toFixed(0)}/ac fertilizer)`);
  }
  if (smapPenalty > 0) {
    rationaleParts.push(`-${smapPenalty}pt SMAP dryland water stress penalty`);
  }
  if (sPest === 0) {
    rationaleParts.push('Same botanical family back-to-back penalty');
  }

  const baseYear = new Date().getUTCFullYear() + yearIndex;

  return {
    year_index: yearIndex,
    season_label: `Year ${yearIndex} (${baseYear})`,
    crop_id: candidate.id,
    crop_name: candidate.name,
    botanical_family: candidate.botanical_family,
    baseline_transition_score: baselineMatrix,
    s_soil: Number(sSoil.toFixed(1)),
    s_pest: Number(sPest.toFixed(1)),
    s_water: Number(sWater.toFixed(1)),
    s_econ: Number(sEcon.toFixed(1)),
    total_score: totalScore,
    legume_n_credit_applied_lbs_acre: appliedNCredit,
    fertilizer_savings_usd_acre: fertilizerSavings,
    smap_penalty_applied: smapPenalty,
    net_n_balance_lbs_acre: Number(netNThisYear.toFixed(1)),
    cumulative_2yr_n_balance_lbs_acre: cumulative2YrN,
    projected_revenue_usd_acre: projectedRevenue,
    projected_cost_usd_acre: projectedCost,
    net_margin_usd_acre: netMargin,
    rationale: rationaleParts.join(' · '),
    overwinter_cover_crops: overwinterCovers,
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

interface BeamState {
  steps: YearPlanStep[];
  historyRecentFirst: string[];
  cumulativeScore: number;
  prevInjectedCoverN: number;
  prevYearNetN: number;
}

/**
 * STAGE 4: Multi-Year Beam Search (beam_width = 5)
 */
export function generateRotationPlans(
  field: FieldRecord,
  overridePreviousCrop?: string
): RotationGenerationResponse {
  const history =
    overridePreviousCrop && PRIMARY_CROP_IDS.includes(overridePreviousCrop)
      ? [overridePreviousCrop, ...field.previous_crops.slice(1)]
      : field.previous_crops.length > 0
        ? field.previous_crops
        : ['corn'];

  const prevCropId = history[0] || 'corn';
  const prevCrop = getCropById(prevCropId);

  // Stage 1: Gate elimination
  const { passingCrops, gateAuditLog } = runStage1Gates(field, history);
  const BEAM_WIDTH = 5;

  if (passingCrops.length === 0) {
    return {
      field_id: field.id,
      field_name: field.name,
      generated_at: new Date().toISOString(),
      beam_width: BEAM_WIDTH,
      previous_crop: prevCrop.name,
      gate_audit_log: gateAuditLog,
      passing_crops_count: 0,
      ranked_plans: [],
    };
  }

  let beam: BeamState[] = [
    {
      steps: [],
      historyRecentFirst: history,
      cumulativeScore: 0,
      prevInjectedCoverN: 0,
      prevYearNetN: prevCrop.n_balance_lbs_acre * 0.4,
    },
  ];

  // Expand 3 seasonal horizons
  for (let yearIdx = 1; yearIdx <= 3; yearIdx += 1) {
    const nextBeam: BeamState[] = [];

    for (const state of beam) {
      const currentPrevCrop = state.historyRecentFirst[0];
      // Enforce dynamic disease break against the growing sequence
      const yearCandidates = passingCrops.filter((c) =>
        yearIdx === 1 ? true : passesDiseaseBreakForSequence(c, state.historyRecentFirst)
      );
      const effectiveCandidates = yearCandidates.length > 0 ? yearCandidates : passingCrops;

      for (const cand of effectiveCandidates) {
        const step = evaluateCandidateStep({
          field,
          candidate: cand,
          prevCropId: currentPrevCrop,
          historyRecentFirst: state.historyRecentFirst,
          prevInjectedCoverN: state.prevInjectedCoverN,
          prev2YrNetN: state.prevYearNetN,
          yearIndex: yearIdx,
        });

        const coverN = step.overwinter_cover_crops.reduce(
          (sum, cov) => sum + cov.n_credit_lbs_acre,
          0
        );

        nextBeam.push({
          steps: [...state.steps, step],
          historyRecentFirst: [cand.id, ...state.historyRecentFirst],
          cumulativeScore: state.cumulativeScore + step.total_score,
          prevInjectedCoverN: coverN,
          prevYearNetN: step.net_n_balance_lbs_acre,
        });
      }
    }

    // Keep top beam_width = 5 partial trajectories, promoting sequence diversity
    nextBeam.sort((a, b) => b.cumulativeScore - a.cumulativeScore);
    beam = nextBeam.slice(0, BEAM_WIDTH);
  }

  // Deduplicate identical sequences and pick Top 3
  const seen = new Set<string>();
  const top3: RankedRotationPlan[] = [];

  for (const state of beam) {
    const sig = state.steps.map((s) => s.crop_id).join('->');
    if (seen.has(sig)) continue;
    seen.add(sig);

    const n = state.steps.length;
    const avgSoil = Number((state.steps.reduce((s, x) => s + x.s_soil, 0) / n).toFixed(1));
    const avgPest = Number((state.steps.reduce((s, x) => s + x.s_pest, 0) / n).toFixed(1));
    const avgWater = Number((state.steps.reduce((s, x) => s + x.s_water, 0) / n).toFixed(1));
    const avgEcon = Number((state.steps.reduce((s, x) => s + x.s_econ, 0) / n).toFixed(1));
    const composite = Number((state.cumulativeScore / n).toFixed(1));

    const cumMargin = Number(
      state.steps.reduce((s, x) => s + x.net_margin_usd_acre, 0).toFixed(2)
    );
    const cumN = Number(
      state.steps.reduce((s, x) => s + x.net_n_balance_lbs_acre, 0).toFixed(1)
    );
    const totalSavings = Number(
      state.steps.reduce((s, x) => s + x.fertilizer_savings_usd_acre, 0).toFixed(2)
    );
    const coverCount = state.steps.reduce((s, x) => s + x.overwinter_cover_crops.length, 0);

    top3.push({
      rank: top3.length + 1,
      plan_id: `plan-${sig}`,
      composite_3yr_score: composite,
      avg_s_soil: avgSoil,
      avg_s_pest: avgPest,
      avg_s_water: avgWater,
      avg_s_econ: avgEcon,
      cumulative_3yr_net_margin_usd_acre: cumMargin,
      cumulative_3yr_n_balance_lbs_acre: cumN,
      total_fertilizer_savings_usd_acre: totalSavings,
      cover_crop_injections_count: coverCount,
      steps: state.steps,
    });

    if (top3.length === 3) break;
  }

  return {
    field_id: field.id,
    field_name: field.name,
    generated_at: new Date().toISOString(),
    beam_width: BEAM_WIDTH,
    previous_crop: prevCrop.name,
    gate_audit_log: gateAuditLog,
    passing_crops_count: passingCrops.length,
    ranked_plans: top3,
  };
}
