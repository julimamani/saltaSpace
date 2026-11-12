"""Parametric trigger, evaluated off-chain with the same rule CampaignVault enforces on-chain
(`_triggered`) so the UI can explain *why* a coverage fires before the transaction exists.

    riesgo_hidrico  = ALTO   if rain < ETc  and  NDWI < ndwi_trigger
                    = MEDIO  if only one of the two holds
    trigger_seguro  = (NDWI < ndwi_trigger and (rain < 50% normal or (critical_dry_days >= X and balance < 0)))
                      or ndvi_drop >= 40%  or  soil_dry_days (Sentinel-1) >= 21
    riesgo_climatico= ALTO if trigger or risk_score >= 60; MEDIO if any condition or risk >= 35; else BAJO
"""

from __future__ import annotations

from ..config import Settings
from ..schemas import InsuranceEvaluation, SarSummary, WaterBalance


def evaluate(wb: WaterBalance, ndwi: float | None, ndvi_drop: float, sar: SarSummary, risk_score: int, s: Settings) -> InsuranceEvaluation:
    deficit = wb.rain_mm < wb.etc_mm
    ndwi_low = ndwi is not None and ndwi < s.ndwi_trigger
    rain_short = wb.rain_vs_normal is not None and wb.rain_vs_normal < s.rain_trigger_ratio
    dry_days = wb.critical_dry_days >= s.dry_days_trigger and wb.balance_mm < 0
    ndvi_collapse = ndvi_drop >= s.ndvi_drop_trigger
    soil_dry = sar.soil_dry_days >= s.soil_dry_days_trigger

    hidrico = "ALTO" if (deficit and ndwi_low) else "MEDIO" if (deficit or ndwi_low) else "BAJO"
    trigger = (ndwi_low and (rain_short or dry_days)) or ndvi_collapse or soil_dry
    any_cond = deficit or ndwi_low or rain_short or dry_days or ndvi_collapse or soil_dry
    climatico = "ALTO" if (trigger or risk_score >= 60) else "MEDIO" if (any_cond or risk_score >= 35) else "BAJO"

    motivos: list[str] = []
    if deficit:
        motivos.append(f"Lluvia {wb.rain_mm:.0f} mm < ETc {wb.etc_mm:.0f} mm (Penman-Monteith × Kc {wb.crop_label})")
    if ndwi_low:
        motivos.append(f"NDWI {ndwi:.3f} < umbral {s.ndwi_trigger:.2f}: estrés hídrico en hoja")
    if rain_short:
        motivos.append(f"Lluvia al {wb.rain_vs_normal * 100:.0f}% del histórico (< {s.rain_trigger_ratio * 100:.0f}%)")
    if dry_days:
        motivos.append(f"{wb.critical_dry_days} días críticos secos en floración (≥ {s.dry_days_trigger}) con balance {wb.balance_mm:.0f} mm")
    if ndvi_collapse:
        motivos.append(f"NDVI cayó {ndvi_drop * 100:.0f}% desde el pico de campaña (≥ {s.ndvi_drop_trigger * 100:.0f}%)")
    if soil_dry:
        motivos.append(f"Sentinel-1: suelo seco {sar.soil_dry_days} días seguidos (≥ {s.soil_dry_days_trigger})")
    if not motivos:
        motivos.append("Sin condiciones de disparo: lluvia, NDWI, NDVI y radar dentro de lo normal")

    return InsuranceEvaluation(
        riesgo_hidrico=hidrico,  # type: ignore[arg-type]
        riesgo_climatico=climatico,  # type: ignore[arg-type]
        trigger_seguro=trigger,
        condiciones={
            "precipitacion_menor_etc": deficit,
            "ndwi_bajo_umbral": ndwi_low,
            "lluvia_bajo_50pct_historico": rain_short,
            "dias_criticos_floracion": dry_days,
            "caida_drastica_ndvi": ndvi_collapse,
            "suelo_seco_prolongado_sar": soil_dry,
        },
        motivos=motivos,
        umbrales={
            "ndwi": s.ndwi_trigger,
            "lluvia_vs_historico": s.rain_trigger_ratio,
            "dias_criticos": s.dry_days_trigger,
            "caida_ndvi": s.ndvi_drop_trigger,
            "dias_suelo_seco_sar": s.soil_dry_days_trigger,
        },
        metricas={
            "lluvia_mm": wb.rain_mm,
            "et0_mm": wb.et0_mm,
            "etc_mm": wb.etc_mm,
            "balance_mm": wb.balance_mm,
            "lluvia_vs_historico": wb.rain_vs_normal,
            "dias_criticos": wb.critical_dry_days,
            "ndwi": ndwi,
            "caida_ndvi": round(ndvi_drop, 4),
            "dias_suelo_seco_sar": sar.soil_dry_days,
            "vv_db": sar.latest_vv_db,
            "risk_score": risk_score,
        },
    )
