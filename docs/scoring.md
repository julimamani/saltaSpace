# Fórmulas del oráculo · `agro-score-v2`

Todo lo que el oráculo publica on-chain sale de datos públicos y de las fórmulas de este documento. Los pesos y umbrales son variables de entorno (`backend/.env.example`) y los defaults on-chain viven en `CampaignVault` (`PayoutParams`, `InsuranceParams`).

## 1. Índices satelitales (Sentinel‑2 L2A, Earth Search)

Para cada semana ISO se elige la escena con menos nubes (`eo:cloud_cover < MAX_CLOUD_COVER`), se leen solo las ventanas de los COG que cubren el polígono, se enmascaran nubes/sombras con la banda SCL y se calcula sobre reflectancia de superficie:

| Índice | Fórmula | Qué mide |
|---|---|---|
| NDVI | (B08 − B04) / (B08 + B04) | Vigor. Se satura en canopias densas y no atraviesa nubes. |
| EVI | 2.5 (B08 − B04) / (B08 + 6 B04 − 7.5 B02 + 1) | Vigor corregido por atmósfera y suelo; mejor en cultivos maduros. |
| NDWI | (B08 − B11) / (B08 + B11) | Agua en la hoja (Gao 1996). Cae antes de que el NDVI acuse el estrés. |
| LAI | 3.618 · EVI − 0.118 (Boegh et al. 2002) | Área foliar → biomasa → rinde. |

> Earth Search ya aplica el `BOA_ADD_OFFSET` de ESA a sus COG (`earthsearch:boa_offset_applied = true`), así que el offset −0.1 de `raster:bands` **no** se vuelve a aplicar. Aplicarlo dos veces infla el NDVI (0.51 → 0.87).

`ndvi_drop = (NDVI_pico − NDVI_último) / NDVI_pico` sobre la serie de la campaña.

## 2. Radar (Sentinel‑1 RTC, Microsoft Planetary Computer)

Gamma0 VV y VH (10 m) promediados sobre el lote, en dB. `RVI = 4·VH / (VV + VH)` (potencia lineal) como proxy de biomasa. Un día es de **suelo seco** cuando `VV < SAR_DRY_SOIL_VV_DB` (−14 dB); `soil_dry_days` es la racha de escenas secas hasta la última (+6 días de revisita). Si la última escena Sentinel‑2 tiene más de `CLOUD_PRIORITY_THRESHOLD` (20%) de nubes, o es mock, el radar es la fuente prioritaria (`satellite_priority = sentinel-1`) y una racha seca prolongada fija un piso de riesgo 60.

## 3. ET0 · FAO‑56 Penman‑Monteith (`et0.py`)

```
ET0 = [0.408 Δ (Rn − G) + γ (900 / (T + 273)) u2 (es − ea)] / [Δ + γ (1 + 0.34 u2)]
```

Entradas diarias de Open‑Meteo (archivo ERA5 + pronóstico para los últimos días): Tmax, Tmin, radiación de onda corta (MJ/m²), humedad relativa máx/mín/media y viento a 10 m (→ 2 m con la ec. 47). Radiación extraterrestre y de cielo claro con latitud, altitud y día del año (ec. 21‑40). NASA POWER (T2M_MAX/MIN, RH2M, WS2M, ALLSKY_SFC_SW_DWN) es el respaldo completo si Open‑Meteo falla. Se guarda el ET0 de Open‑Meteo como control (`et0_ref_mm`).

## 4. ETc y balance hídrico (`crops.py`, `hydro.py`)

```
ETc_i = ET0_i × Kc(etapa_i)                 Kc_ini / Kc_mid / Kc_end y duraciones FAO‑56 tablas 11‑12
TAW   = 1000 (θFC − θWP) Zr                 reserva útil (θFC − θWP = 0.15, Zr por cultivo)
RAW   = p · TAW                             agua fácilmente aprovechable
Dr_i  = clamp(Dr_{i−1} − P_i + ETc_i, 0, TAW)   agotamiento de la zona radicular (ec. 85, sin riego)
día crítico  ⇔  Dr_i > RAW  y  etapa = floración (mid‑season)
balance_mm   = Σ P − Σ ETc sobre la campaña
rain_vs_normal = Σ P / climatología NASA POWER 2001‑2025 del mismo calendario (1.0 si la normal < 10 mm)
```

Fecha de siembra: la informa el productor (`PUT /lots/{id}/profile` o `sowing_date` en `/lots/analyze`); si no, se estima como `madurez − ciclo del cultivo` y, si eso cae en el futuro, se asume que el cultivo está **en plena floración hoy** (la hipótesis conservadora para un oráculo de sequía; la UI muestra el supuesto).

## 5. Score

```
ndvi_score   = clamp((NDVI − 0.2) / (0.8 − 0.2))
evi_score    = clamp((EVI − 0.15) / (0.6 − 0.15))
vigor_score  = media(ndvi_score, evi_score)
ndwi_score   = clamp((NDWI + 0.1) / 0.5)
water_score  = 1 − clamp((ETc − lluvia) / ETc)
stress_score = 1 − clamp(días_críticos / 20)
heat_score   = 1 − clamp(3 · días_Tmax≥35°C / días)
sar_score    = clamp((RVI − 0.3) / 0.65)
health       = Σ wᵢ · scoreᵢ / Σ wᵢ      w = vigor 0.35 · ndwi 0.15 · agua 0.20 · estrés 0.15 · calor 0.05 · radar 0.10
risk_score   = round(100 · (1 − health))          → on-chain 0‑100
yield_index  = 0.5 + 0.8 · health                 → on-chain bps 5000‑13000
```

Los componentes sin dato (p. ej. sin SWIR o sin radar) se quitan y los pesos se renormalizan.

## 6. Pago on-chain (`CampaignVault`)

```
multiplier = 1 + APY × yield_index
sequía     = NDVI < 0.30  o  criticalDryDays ≥ 10
si sequía: multiplier −= 0.15
multiplier = clamp(multiplier, 0.80, 1.30)
payoutPerToken = pricePerToken × multiplier
```

Lo disponible para pagar es `repago del productor + cobertura del seguro (+ capital no liberado)`; si no alcanza, se paga pro‑rata y el excedente vuelve al productor.

## 7. Trigger del seguro paramétrico

Ver [seguro-parametrico.md](seguro-parametrico.md). La regla es idéntica en `backend/app/services/insurance.py` y en `CampaignVault._triggered`.

## Escenarios de demo

`drought`: NDVI → 0.22, EVI → 0.12, NDWI → −0.15, lluvia × 0.15, Tmax + 4 °C, radar con suelo seco 30 días. `excellent`: NDVI → 0.85, NDWI → 0.35, lluvia × 1.6. En ambos casos la fórmula completa (balance, score, trigger) se corre igual sobre los datos modificados, así el efecto on-chain es explicable.
