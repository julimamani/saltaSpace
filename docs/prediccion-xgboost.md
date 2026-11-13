# Capa predictiva XGBoost (riesgo de sequía a 15 días)

> Prototipo educativo / testnet. El modelo está entrenado con **datos simulados**: es orientativo,
> no es garantía de rendimiento y **no** modifica el score, el seguro paramétrico ni nada on-chain.

## Qué hace
El oráculo mide el presente (NDVI/NDWI, balance hídrico, radar) y el contrato reacciona con el
trigger paramétrico. Esta capa agrega una mirada hacia adelante: un `XGBClassifier` estima la
probabilidad de **sequía severa en los próximos 15 días** (`riesgo_sequia_15dias`).

| Feature | Fuente en el oráculo |
|---|---|
| `precipitacion_7d_acumulada`, `precipitacion_15d_acumulada` | Open‑Meteo / NASA POWER (`weather.daily`) |
| `temp_max_promedio`, `radiacion_solar`, `ET0_fao` | Promedio de 7 días; ET0 FAO‑56 Penman‑Monteith propio |
| `NDVI_actual`, `NDWI_actual` | Sentinel‑2 L2A |
| `radar_soil_moisture` | Sentinel‑1 VV → proxy volumétrico (−20 dB ≈ seco, −8 dB ≈ húmedo) |
| `dia_del_anio`, `etapa_floracion` | Calendario + etapa FAO‑56 del cultivo |

## Dataset y entrenamiento
`app/ml/drought.py::generate_mock_dataset` simula 5 años diarios del NOA (lluvias de verano,
inviernos secos, rachas secas/húmedas persistentes, balde de humedad de suelo, NDVI/NDWI que
responden con retardo). Target = 1 si en los 15 días siguientes la lluvia es < 35% de la ETc y
el suelo queda < 0,15 m³/m³. Split cronológico 80/20, se reportan AUC y accuracy.

El modelo se entrena solo la primera vez que se pide una predicción (~1 s) y se guarda con
`joblib` junto a la base (`xgb_sequia.joblib`). Para reentrenar: `python -m app.ml.drought`.
Si `xgboost` no está instalado, la API sigue funcionando y estos endpoints responden 503.

## Endpoints
- `POST /predict/sequia` — recibe las 10 features del día y devuelve la probabilidad.
- `GET /lots/{id}/prediccion[?refresh=true]` — arma las features con el último análisis publicado
  por el oráculo (o uno en vivo).
- `GET /predict/modelo` — versión, métricas y features.

Respuesta: `probabilidad_sequia`, `riesgo` (BAJO < 30% ≤ MEDIO < 60% ≤ ALTO), `factores`,
`importancia_global`, `timestamp`, `aviso`.

## Factores "que más influyen hoy"
`factores` usa las contribuciones SHAP de XGBoost para **esa** predicción
(`booster.predict(..., pred_contribs=True)`), agrupadas (lluvia, temperatura y radiación, ET0,
NDVI, NDWI, suelo, época) y normalizadas a 100% entre las que suben el riesgo.
`importancia_global` es `feature_importances_`: lo que pesa el modelo en general, igual para
todos los lotes.

## Front
`RiskChart` (`front/src/app/shared/risk-chart.ts`): dona de Chart.js (sin `ng2-charts`) con
`animateScale`, tooltip, riesgo total en el centro y hora del análisis. Está en el Inicio
(selector de lote + ejemplo) y en el detalle de cada lote.

## Próximos pasos
Reentrenar con el historial real del oráculo y rindes del MAGyP; recién con un modelo validado
tendría sentido publicar la probabilidad on-chain (requiere cambiar `OracleConsumer` y redesplegar).
