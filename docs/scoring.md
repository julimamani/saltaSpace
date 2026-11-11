# Fórmula de riesgo, rendimiento y pago (`agro-score-v1`)

Todo es configurable por variables de entorno del backend (`backend/.env`) y por `setPayoutParams` en el contrato.

## 1. Datos de entrada (backend)

| Dato | Fuente | Detalle |
|---|---|---|
| NDVI medio/min/max | Sentinel‑2 L2A en [Earth Search STAC](https://earth-search.aws.element84.com/v1) | Escenas de los últimos `ANALYSIS_WINDOW_DAYS` (90) con nubes < `MAX_CLOUD_COVER` (30%), hasta `MAX_SCENES` (6). Se leen por ventana los COG `red` (B04) y `nir` (B08) recortados al polígono, se enmascaran nubes/sombras con la banda SCL y se calcula `NDVI = (B08 − B04) / (B08 + B04)`. |
| Fallback | Mock determinístico | Si no se puede leer ningún raster, serie NDVI estacional con seed = sha256(polígono + fechas), marcada `source: "mock"`. |
| Lluvia, ET0, temperatura | [Open‑Meteo](https://open-meteo.com) archive + forecast | Diario. Déficit hídrico = max(0, ET0 − lluvia). Días de estrés térmico = días con Tmax ≥ `HEAT_STRESS_TEMP_C` (35 °C). |
| Radiación, lluvia y temperatura de control | [NASA POWER](https://power.larc.nasa.gov) | `ALLSKY_SFC_SW_DWN`, `PRECTOTCORR`, `T2M`. |

## 2. Puntaje

```text
ndvi_score  = clamp((ndvi_mean − NDVI_REF_LOW) / (NDVI_REF_HIGH − NDVI_REF_LOW), 0, 1)   # 0.2 … 0.8
water_score = 1 − clamp(water_deficit / et0, 0, 1)
heat_score  = 1 − clamp(3 × heat_stress_days / period_days, 0, 1)
health      = W_NDVI × ndvi_score + W_WATER × water_score + W_HEAT × heat_score        # 0.6 / 0.3 / 0.1
risk_score  = round(100 × (1 − health))        # 0 (sano) … 100 (crítico)
yield_index = 0.5 + 0.8 × health                # 0.5 … 1.3
```

El backend publica on-chain `ndvi × 10000`, `risk_score`, `yield_index × 10000` y un `dataHash = keccak256(JSON canónico del análisis)` que ancla escenas, clima y versión de fórmula.

## 3. Pago al inversor (contrato `CampaignVault`)

```text
multiplier = 1 + targetApy × yieldIndex
if ndvi < criticalNdvi (0.30):  multiplier −= droughtHaircut (0.15)
multiplier = clamp(multiplier, minPayout (0.80), maxPayout (1.30))
payoutPerToken = pricePerToken × multiplier
```

Si el repago depositado por el productor no alcanza (`available < totalOwed`), cada token cobra `available / tokensSold` (pro‑rata). El excedente vuelve al productor.

### Ejemplos (token de 10 USDC, APY objetivo 18%)

| Escenario | NDVI | yield | multiplicador | pago/token |
|---|---|---|---|---|
| Cosecha excelente | 0.85 | 1.30 | 1 + 0.18×1.30 = 1.234 | 12.34 |
| Normal | 0.60 | 1.02 | 1.184 | 11.84 |
| Sequía | 0.22 | 0.58 | 1.104 − 0.15 = 0.954 | 9.54 |
| Sequía extrema (APY 5%) | 0.10 | 0.50 | 1.025 − 0.15 → piso 0.80 | 8.00 |

## 4. Escenarios de demo

`POST /demo/scenario/{lotId}` con `drought` / `excellent` / `real` (o `SIMULATE_DROUGHT=true` global) transforma la serie NDVI y el clima reales antes de puntuar y publica al instante. El análisis guarda `scenario` para que quede claro que fue forzado.
