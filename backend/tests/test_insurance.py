from datetime import date

from app.config import Settings
from app.schemas import SarObservation, SarSummary, WaterBalance
from app.services import insurance, sar

S = Settings(_env_file=None)


def _wb(**over) -> WaterBalance:
    base = dict(
        crop="poroto", crop_label="Poroto", sowing_date=date(2026, 1, 1), sowing_basis="test", harvest_date=date(2026, 4, 20), stage_today="floracion",
        flowering_start=date(2026, 2, 20), flowering_end=date(2026, 3, 31), season_start=date(2026, 1, 1), rain_mm=300, et0_mm=350, etc_mm=280, balance_mm=20,
        critical_dry_days=0, flowering_days_observed=20, max_dry_spell_days=2, normal_rain_mm=320, rain_vs_normal=0.94, taw_mm=105, raw_mm=47,
    )
    base.update(over)
    return WaterBalance(**base)


def _sar(dry_days: int) -> SarSummary:
    return SarSummary(soil_dry_days=dry_days, latest_vv_db=-12.0, latest_rvi=0.5, source="sentinel-1")


def test_healthy_lot_has_no_trigger():
    e = insurance.evaluate(_wb(), ndwi=0.25, ndvi_drop=0.05, sar=_sar(0), risk_score=20, s=S)
    assert e.trigger_seguro is False and e.riesgo_hidrico == "BAJO" and e.riesgo_climatico == "BAJO"


def test_rain_below_etc_and_low_ndwi_is_high_water_risk_and_triggers_with_rain_shortfall():
    e = insurance.evaluate(_wb(rain_mm=120, balance_mm=-160, rain_vs_normal=0.38), ndwi=-0.1, ndvi_drop=0.1, sar=_sar(0), risk_score=55, s=S)
    assert e.riesgo_hidrico == "ALTO" and e.trigger_seguro is True and e.riesgo_climatico == "ALTO"
    assert e.condiciones["precipitacion_menor_etc"] and e.condiciones["ndwi_bajo_umbral"] and e.condiciones["lluvia_bajo_50pct_historico"]


def test_low_ndwi_alone_is_medium_and_does_not_trigger():
    e = insurance.evaluate(_wb(), ndwi=-0.1, ndvi_drop=0.1, sar=_sar(0), risk_score=30, s=S)
    assert e.riesgo_hidrico == "MEDIO" and e.trigger_seguro is False


def test_ndvi_collapse_or_radar_dry_soil_trigger_on_their_own():
    assert insurance.evaluate(_wb(), ndwi=0.3, ndvi_drop=0.45, sar=_sar(0), risk_score=30, s=S).trigger_seguro
    assert insurance.evaluate(_wb(), ndwi=0.3, ndvi_drop=0.0, sar=_sar(24), risk_score=30, s=S).trigger_seguro
    e = insurance.evaluate(_wb(critical_dry_days=12, balance_mm=-30), ndwi=0.0, ndvi_drop=0.0, sar=_sar(0), risk_score=40, s=S)
    assert e.trigger_seguro and e.condiciones["dias_criticos_floracion"]


def test_sar_dry_days_counts_trailing_dry_run():
    def o(d: date, dry: bool) -> SarObservation:
        return SarObservation(date=d, vv_db=-16 if dry else -10, vh_db=-20, ratio_db=-6, rvi=0.4, dry_soil=dry, source="mock")

    obs = [o(date(2026, 1, 1), False), o(date(2026, 1, 13), True), o(date(2026, 1, 25), True)]
    assert sar.soil_dry_days(obs) == 12 + 6
    assert sar.soil_dry_days(obs[:1]) == 0
    assert sar.soil_dry_days([]) == 0
