# Seguro paramétrico embebido en el token

## El problema

Si un productor pierde la cosecha por sequía, un perito debe viajar al lote, evaluar el daño (subjetivo) y la aseguradora tarda meses en pagar. Para el inversor del RWA eso es riesgo climático sin cobertura; para el productor, liquidez que llega tarde.

## La solución

El seguro vive dentro del `CampaignVault`:

1. **Prima**: cuando el productor retira el capital (`releaseFundsToProducer`), el **3%** (`premiumBps`) queda en un `insurancePool` compartido por todos los lotes. Cualquiera puede sumar liquidez con `fundInsurancePool` (en la demo, el deployer aporta 2.000 USDC).
2. **Oráculo diario**: el backend calcula NDVI/EVI/NDWI (Sentinel‑2), VV/VH (Sentinel‑1) y el balance de evapotranspiración (Penman‑Monteith × Kc) y publica `Metrics` en `OracleConsumer`.
3. **Trigger on-chain** (`CampaignVault._triggered`), evaluado por el contrato con esas métricas:

```
(NDWI < 0.05  y  (lluvia < 50% del histórico  o  (días críticos ≥ 10  y  balance hídrico < 0)))
  o  NDVI cayó ≥ 40% desde el pico de la campaña
  o  Sentinel‑1 marca suelo seco ≥ 21 días seguidos
```

4. **Ejecución automática**: `executeInsurance(lotId)` es permissionless; `settle()` también la ejecuta si corresponde. El pool paga **20%** del capital del lote (`coverageBps`, limitado por el saldo del pool) y ese monto se suma a lo que cobran los inversores con `claim()`. Sin peritos, sin burocracia, 100% basado en datos inmutables (`dataHash` ancla el payload del oráculo).

## Lectura humana

`GET /lots/{id}/seguro` devuelve la misma evaluación hecha off-chain, con motivos legibles:

```json
{
  "riesgo_hidrico": "ALTO",
  "riesgo_climatico": "ALTO",
  "trigger_seguro": true,
  "condiciones": {
    "precipitacion_menor_etc": true,
    "ndwi_bajo_umbral": true,
    "lluvia_bajo_50pct_historico": false,
    "dias_criticos_floracion": true,
    "caida_drastica_ndvi": false,
    "suelo_seco_prolongado_sar": false
  },
  "motivos": ["Lluvia 114 mm < ETc 217 mm (Penman-Monteith × Kc Poroto)", "..."]
}
```

- `riesgo_hidrico = ALTO` si lluvia < ETc **y** NDWI < umbral; `MEDIO` si solo una.
- `riesgo_climatico = ALTO` si hay trigger o `risk_score ≥ 60`; `MEDIO` si alguna condición o `risk_score ≥ 35`.

## Parámetros (admin)

`setInsuranceParams({premiumBps, coverageBps, rainTriggerBps, ndwiTrigger, dryDaysTrigger, ndviDropTriggerBps, soilDryDaysTrigger})` y `setPayoutParams({criticalNdvi, criticalDryDays, droughtHaircutBps, minPayoutBps, maxPayoutBps})`. Los mismos umbrales se configuran en el backend (`NDWI_TRIGGER`, `RAIN_TRIGGER_RATIO`, ...) para que la explicación coincida con lo que paga el contrato.

## Limitaciones (prototipo)

- El pool se financia con primas y aportes voluntarios: no hay cálculo actuarial ni reaseguro.
- Umbrales (NDWI 0.05, −14 dB, 50% del histórico) son valores de referencia bibliográficos, no calibrados por cultivo/zona.
- La fecha de siembra la informa el productor; si no, se asume floración hoy.
- En producción el trigger debería venir de varios oráculos independientes (Chainlink Functions / DON) y ser auditado.
