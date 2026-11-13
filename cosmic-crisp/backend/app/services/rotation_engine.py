from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple
from app.models.domain import Crop

N_FERTILIZER_PRICE_PER_LB = 0.68


def _clamp(v: float) -> float:
    return max(0.0, min(100.0, round(v, 1)))


def run_stage1_gates(
    crops: List[Crop],
    soil: Dict[str, Any],
    telemetry: Dict[str, Any],
    history_recent_first: List[str],
) -> Tuple[List[Crop], List[Dict[str, Any]]]:
    passing: List[Crop] = []
    audit_log: List[Dict[str, Any]] = []

    for crop in [c for c in crops if not c.is_cover_crop]:
        ph_ok = crop.ph_min <= soil["ph"] <= crop.ph_max
        sal_ok = soil["salinity_dsm"] <= crop.max_salinity_dsm
        gdd_ok = telemetry["gdd_85th_percentile"] >= crop.gdd_required
        frost_ok = telemetry["frost_free_days"] >= (crop.frost_free_days_min + 14)

        break_ok = True
        break_detail = f"No break conflict (min {crop.min_rotation_break_years} yr break)"
        if crop.min_rotation_break_years > 0:
            window = history_recent_first[: crop.min_rotation_break_years]
            if crop.id in window:
                idx = window.index(crop.id)
                break_ok = False
                break_detail = (
                    f"Blocked: grown {idx + 1} yr ago; requires {crop.min_rotation_break_years}-yr botanical break"
                )

        reasons: List[str] = []
        if not ph_ok:
            reasons.append(f"pH {soil['ph']:.1f} outside [{crop.ph_min:.1f}-{crop.ph_max:.1f}]")
        if not sal_ok:
            reasons.append(f"Salinity {soil['salinity_dsm']:.2f} > {crop.max_salinity_dsm:.2f} dS/m")
        if not gdd_ok:
            reasons.append(f"GDD {telemetry['gdd_85th_percentile']} < {crop.gdd_required}")
        if not frost_ok:
            reasons.append(f"Frost-free {telemetry['frost_free_days']}d < {crop.frost_free_days_min + 14}d")
        if not break_ok:
            reasons.append(break_detail)

        passed = ph_ok and sal_ok and gdd_ok and frost_ok and break_ok
        if passed:
            passing.append(crop)

        audit_log.append(
            {
                "crop_id": crop.id,
                "crop_name": crop.name,
                "botanical_family": crop.botanical_family,
                "passed": passed,
                "gates": {
                    "ph_gate": {"passed": ph_ok, "detail": f"pH {soil['ph']:.1f} vs [{crop.ph_min:.1f}-{crop.ph_max:.1f}]"},
                    "salinity_gate": {"passed": sal_ok, "detail": f"{soil['salinity_dsm']:.2f} <= {crop.max_salinity_dsm:.2f} dS/m"},
                    "gdd_gate": {"passed": gdd_ok, "detail": f"{telemetry['gdd_85th_percentile']} >= {crop.gdd_required}"},
                    "frost_free_gate": {"passed": frost_ok, "detail": f"{telemetry['frost_free_days']}d >= {crop.frost_free_days_min + 14}d"},
                    "disease_break_gate": {"passed": break_ok, "detail": break_detail},
                },
                "rejection_reasons": reasons,
            }
        )

    return passing, audit_log


def _evaluate_step(
    crop_map: Dict[str, Crop],
    matrix: Dict[str, Dict[str, int]],
    soil: Dict[str, Any],
    telemetry: Dict[str, Any],
    candidate: Crop,
    prev_crop_id: str,
    history_recent_first: List[str],
    prev_cover_n: float,
    prev_2yr_n: float,
    year_index: int,
) -> Dict[str, Any]:
    prev_crop = crop_map[prev_crop_id]
    baseline = matrix.get(prev_crop_id, {}).get(candidate.id, 60)

    raw_legume_n = prev_crop.n_credit_provided_lbs_acre if prev_crop.is_legume else 0.0
    applied_n_credit = min(candidate.fertilizer_n_req_lbs_acre, raw_legume_n + prev_cover_n)
    fert_savings = round(applied_n_credit * N_FERTILIZER_PRICE_PER_LB, 2)

    root_bonus = 10.0 if candidate.root_type != prev_crop.root_type else -8.0
    slope_adj = (
        (candidate.erosion_protection_score - 60) * 0.25
        if soil["mean_slope_pct"] > 5.0
        else (candidate.erosion_protection_score - 55) * 0.08
    )
    n_boost = 8.0 if (not candidate.is_legume and applied_n_credit >= 15) else (6.0 if candidate.is_legume else 0.0)
    s_soil = _clamp(baseline * 0.85 + root_bonus + slope_adj + n_boost + 5.0)

    fam1 = crop_map[history_recent_first[0]].botanical_family if len(history_recent_first) >= 1 else None
    fam2 = crop_map[history_recent_first[1]].botanical_family if len(history_recent_first) >= 2 else None
    if fam1 == candidate.botanical_family:
        s_pest = 0.0
    elif fam2 == candidate.botanical_family:
        s_pest = 50.0
    else:
        s_pest = 98.0 if candidate.id in ("canola", "winter_wheat") else 94.0

    eff_water = (
        max(telemetry["growing_season_precip_mm"], candidate.water_demand_mm)
        if soil["irrigated"]
        else telemetry["growing_season_precip_mm"] + (soil["smap_rootzone_moisture"] - 40) * 2.5
    )
    ratio = eff_water / max(1, candidate.water_demand_mm)
    s_water_base = 92.0 if ratio >= 1.0 else (76.0 + (ratio - 0.78) * 70.0 if ratio >= 0.78 else max(20.0, ratio * 90.0))
    smap_penalty = 20.0 if (soil["smap_rootzone_moisture"] < 30 and not soil["irrigated"] and candidate.water_demand_mm >= 550) else 0.0
    s_water = _clamp(s_water_base - smap_penalty)

    revenue = round(candidate.projected_yield_units_acre * candidate.regional_price_per_unit, 2)
    net_n_fert = max(0.0, candidate.fertilizer_n_req_lbs_acre - applied_n_credit)
    irrig_cost = candidate.base_irrigation_cost_per_acre if soil["irrigated"] else 0.0
    cost = round(candidate.seed_cost_per_acre + net_n_fert * N_FERTILIZER_PRICE_PER_LB + irrig_cost + 145.0, 2)
    margin = round(revenue - cost, 2)
    s_econ = _clamp(((margin + 50.0) / 600.0) * 100.0)

    total_score = round(0.30 * s_soil + 0.25 * s_pest + 0.25 * s_water + 0.20 * s_econ, 1)

    net_n_year = candidate.n_balance_lbs_acre + applied_n_credit * 0.35
    cum_2yr_n = round(prev_2yr_n + net_n_year, 1)

    covers: List[Dict[str, Any]] = []
    if year_index < 3:
        if cum_2yr_n < -40.0 and not candidate.is_legume:
            covers.append(
                {
                    "crop_id": "crimson_clover",
                    "crop_name": "Crimson Clover",
                    "trigger_reason": f"2-year N balance ({cum_2yr_n:.0f} lbs/ac) < -40 lbs/ac with no legume cash crop",
                    "n_credit_lbs_acre": 45.0,
                    "erosion_reduction_pct": 32,
                }
            )
        if soil["mean_slope_pct"] > 5.0:
            covers.append(
                {
                    "crop_id": "winter_cereal_rye",
                    "crop_name": "Winter Cereal Rye",
                    "trigger_reason": f"Field mean slope ({soil['mean_slope_pct']:.1f}%) > 5.0% erosion threshold",
                    "n_credit_lbs_acre": 0.0,
                    "erosion_reduction_pct": 58,
                }
            )

    base_yr = datetime.now(timezone.utc).year + year_index
    return {
        "year_index": year_index,
        "season_label": f"Year {year_index} ({base_yr})",
        "crop_id": candidate.id,
        "crop_name": candidate.name,
        "botanical_family": candidate.botanical_family,
        "baseline_transition_score": baseline,
        "s_soil": s_soil,
        "s_pest": s_pest,
        "s_water": s_water,
        "s_econ": s_econ,
        "total_score": total_score,
        "legume_n_credit_applied_lbs_acre": applied_n_credit,
        "fertilizer_savings_usd_acre": fert_savings,
        "smap_penalty_applied": smap_penalty,
        "net_n_balance_lbs_acre": round(net_n_year, 1),
        "cumulative_2yr_n_balance_lbs_acre": cum_2yr_n,
        "projected_revenue_usd_acre": revenue,
        "projected_cost_usd_acre": cost,
        "net_margin_usd_acre": margin,
        "rationale": f"Matrix B={baseline} · N Credit +{applied_n_credit:.0f} lb · Margin ${margin:.0f}/ac",
        "overwinter_cover_crops": covers,
    }


@dataclass
class _BeamNode:
    steps: List[Dict[str, Any]]
    history: List[str]
    score_sum: float
    prev_cover_n: float
    prev_yr_n: float


def run_rotation_engine(
    field_id: str,
    field_name: str,
    crops: List[Crop],
    matrix: Dict[str, Dict[str, int]],
    soil: Dict[str, Any],
    telemetry: Dict[str, Any],
    previous_crops: List[str],
    beam_width: int = 5,
) -> Dict[str, Any]:
    crop_map = {c.id: c for c in crops}
    history = previous_crops if previous_crops else ["corn"]
    prev_crop = crop_map[history[0]]

    passing, audit_log = run_stage1_gates(crops, soil, telemetry, history)
    if not passing:
        return {
            "field_id": field_id,
            "field_name": field_name,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "beam_width": beam_width,
            "previous_crop": prev_crop.name,
            "gate_audit_log": audit_log,
            "passing_crops_count": 0,
            "ranked_plans": [],
        }

    beam: List[_BeamNode] = [
        _BeamNode(
            steps=[],
            history=history,
            score_sum=0.0,
            prev_cover_n=0.0,
            prev_yr_n=prev_crop.n_balance_lbs_acre * 0.4,
        )
    ]

    for yr in (1, 2, 3):
        next_beam: List[_BeamNode] = []
        for node in beam:
            yr_cands = [
                c
                for c in passing
                if yr == 1 or c.min_rotation_break_years == 0 or c.id not in node.history[: c.min_rotation_break_years]
            ] or passing

            for cand in yr_cands:
                step = _evaluate_step(
                    crop_map=crop_map,
                    matrix=matrix,
                    soil=soil,
                    telemetry=telemetry,
                    candidate=cand,
                    prev_crop_id=node.history[0],
                    history_recent_first=node.history,
                    prev_cover_n=node.prev_cover_n,
                    prev_2yr_n=node.prev_yr_n,
                    year_index=yr,
                )
                cov_n = sum(c["n_credit_lbs_acre"] for c in step["overwinter_cover_crops"])
                next_beam.append(
                    _BeamNode(
                        steps=[*node.steps, step],
                        history=[cand.id, *node.history],
                        score_sum=node.score_sum + step["total_score"],
                        prev_cover_n=cov_n,
                        prev_yr_n=step["net_n_balance_lbs_acre"],
                    )
                )
        next_beam.sort(key=lambda x: x.score_sum, reverse=True)
        beam = next_beam[:beam_width]

    seen = set()
    ranked: List[Dict[str, Any]] = []
    for node in beam:
        sig = "->".join(s["crop_id"] for s in node.steps)
        if sig in seen:
            continue
        seen.add(sig)
        n = len(node.steps)
        ranked.append(
            {
                "rank": len(ranked) + 1,
                "plan_id": f"plan-{sig}",
                "composite_3yr_score": round(node.score_sum / n, 1),
                "avg_s_soil": round(sum(s["s_soil"] for s in node.steps) / n, 1),
                "avg_s_pest": round(sum(s["s_pest"] for s in node.steps) / n, 1),
                "avg_s_water": round(sum(s["s_water"] for s in node.steps) / n, 1),
                "avg_s_econ": round(sum(s["s_econ"] for s in node.steps) / n, 1),
                "cumulative_3yr_net_margin_usd_acre": round(sum(s["net_margin_usd_acre"] for s in node.steps), 2),
                "cumulative_3yr_n_balance_lbs_acre": round(sum(s["net_n_balance_lbs_acre"] for s in node.steps), 1),
                "total_fertilizer_savings_usd_acre": round(sum(s["fertilizer_savings_usd_acre"] for s in node.steps), 2),
                "cover_crop_injections_count": sum(len(s["overwinter_cover_crops"]) for s in node.steps),
                "steps": node.steps,
            }
        )
        if len(ranked) == 3:
            break

    return {
        "field_id": field_id,
        "field_name": field_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "beam_width": beam_width,
        "previous_crop": prev_crop.name,
        "gate_audit_log": audit_log,
        "passing_crops_count": len(passing),
        "ranked_plans": ranked,
    }
