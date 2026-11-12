"""FAO-56 crop coefficients (Kc) and stage lengths, used to turn ET0 into crop water
demand: ETc = ET0 x Kc. Stage lengths are days (initial, development, mid-season, late);
mid-season is the flowering / grain-filling window, the one that matters for drought triggers.
Sources: FAO Irrigation & Drainage Paper 56, tables 11 and 12 (rounded for NW Argentina).
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True)
class CropProfile:
    key: str
    label: str
    kc_ini: float
    kc_mid: float
    kc_end: float
    l_ini: int
    l_dev: int
    l_mid: int
    l_late: int
    root_depth_m: float  # max effective rooting depth Zr (FAO-56 table 22)
    depletion_p: float  # fraction of TAW that can be depleted before stress (table 22)

    @property
    def season_days(self) -> int:
        return self.l_ini + self.l_dev + self.l_mid + self.l_late

    @property
    def flowering_offset(self) -> tuple[int, int]:
        """Days after sowing where mid-season starts and ends."""
        start = self.l_ini + self.l_dev
        return start, start + self.l_mid

    def kc(self, days_after_sowing: int) -> float:
        d = days_after_sowing
        if d < 0 or d > self.season_days:
            return 0.0
        if d <= self.l_ini:
            return self.kc_ini
        if d <= self.l_ini + self.l_dev:
            f = (d - self.l_ini) / self.l_dev
            return self.kc_ini + f * (self.kc_mid - self.kc_ini)
        if d <= self.l_ini + self.l_dev + self.l_mid:
            return self.kc_mid
        f = (d - self.l_ini - self.l_dev - self.l_mid) / self.l_late
        return self.kc_mid + f * (self.kc_end - self.kc_mid)

    def stage(self, days_after_sowing: int) -> str:
        d = days_after_sowing
        if d < 0:
            return "pre-siembra"
        if d <= self.l_ini:
            return "inicial"
        if d <= self.l_ini + self.l_dev:
            return "desarrollo"
        if d <= self.l_ini + self.l_dev + self.l_mid:
            return "floracion"
        if d <= self.season_days:
            return "madurez"
        return "cosechado"


CROPS: dict[str, CropProfile] = {
    c.key: c
    for c in (
        CropProfile("soja", "Soja", 0.40, 1.15, 0.50, 20, 30, 60, 25, 1.0, 0.50),
        CropProfile("maiz", "Maíz", 0.30, 1.20, 0.60, 25, 40, 45, 30, 1.2, 0.55),
        CropProfile("poroto", "Poroto", 0.40, 1.15, 0.35, 20, 30, 40, 20, 0.7, 0.45),
        CropProfile("tabaco", "Tabaco", 0.50, 1.15, 0.80, 20, 30, 30, 30, 0.8, 0.50),
        CropProfile("trigo", "Trigo", 0.30, 1.15, 0.25, 20, 25, 60, 30, 1.2, 0.55),
        CropProfile("cana", "Caña de azúcar", 0.40, 1.25, 0.75, 35, 60, 190, 120, 1.5, 0.65),
        CropProfile("generico", "Cultivo genérico", 0.40, 1.10, 0.60, 20, 30, 40, 30, 0.9, 0.50),
    )
}
_ALIASES = {"soya": "soja", "frijol": "poroto", "porotos": "poroto", "beans": "poroto", "corn": "maiz", "wheat": "trigo", "sugarcane": "cana", "cana de azucar": "cana"}


def normalize(name: str | None) -> str:
    if not name:
        return "generico"
    s = unicodedata.normalize("NFKD", name.lower().strip())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = _ALIASES.get(s, s)
    for key in CROPS:
        if s == key or s.startswith(key) or key in s:
            return key
    return "generico"


def profile_for(name: str | None) -> CropProfile:
    return CROPS[normalize(name)]


def estimate_sowing(crop: CropProfile, today: date, harvest: date | None) -> tuple[date, str]:
    """Sowing date when the producer did not provide one.
    - If the campaign maturity (harvest) implies a sowing date in the past, use it.
    - Otherwise assume the crop is mid-flowering today (the most water-sensitive stage), which
      is the conservative choice for a drought oracle. The assumption is reported as `basis`.
    """
    if harvest is not None:
        sowing = harvest - timedelta(days=crop.season_days)
        if sowing <= today:
            return sowing, "madurez de la campaña - duración del ciclo FAO-56"
    f_start, f_end = crop.flowering_offset
    return today - timedelta(days=(f_start + f_end) // 2), "supuesto: cultivo en plena floración hoy"
