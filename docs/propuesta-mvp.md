# Propuesta MVP y de negocio

> Prototipo educativo / testnet. Nada de esto es una oferta pública ni una tokenización legal.

## 1. Datos satelitales y climáticos para el MVP

### Lo que ya usa el oráculo

| Fuente | Qué mide | Resolución | Revisita | Acceso | Uso en el MVP |
|---|---|---|---|---|---|
| **Sentinel‑2 L2A** (ESA/Copernicus) | Óptico multiespectral, 13 bandas: B02‑B04, B08 (10 m); B05‑B07, B8A, B11, B12 (20 m) | 10–20 m | ~5 días (constelación de 2 satélites) | Gratis, Earth Search STAC (AWS), COG | NDVI (B08/B04), EVI (B02/B04/B08), NDWI (B08/B11), LAI estimado. Máscara de nubes con la banda SCL |
| **Sentinel‑1 RTC** (ESA/Copernicus) | Radar SAR banda C, polarizaciones VV y VH | 10 m | 6–12 días según satélites operativos | Gratis, Microsoft Planetary Computer (token SAS público) | Atraviesa nubes: biomasa (RVI, VH/VV) y humedad superficial del suelo (VV). Prioritario si Sentinel‑2 tiene > 20% de nubes |
| **Open‑Meteo** (ERA5 + modelos de pronóstico) | Temp. mín/máx, radiación, humedad, viento, lluvia diaria | ~9–25 km | Diario | Gratis, sin clave | Entradas de ET0 Penman‑Monteith y lluvia real |
| **NASA POWER** (MERRA‑2 / CERES) | Variables agro diarias + climatología | ~0,5° (~50 km) | Diario | Gratis, sin clave | Respaldo de clima y **lluvia histórica 2001‑2025** para el trigger "lluvia < 50% del histórico" |

Variables derivadas: ET0 (FAO‑56), ETc = ET0 × Kc por cultivo y etapa, balance lluvia − ETc, días críticos secos en floración, caída de NDVI desde el pico, días de suelo seco por radar.

### Lo que conviene sumar después del MVP

| Fuente | Por qué |
|---|---|
| **CHIRPS** (lluvia satelital, ~5 km, diaria) | Estándar de la industria de seguros paramétricos; mejor resolución de lluvia que ERA5 en zonas sin estaciones |
| **Landsat 8/9** (30 m, ~8 días combinados, banda térmica) | Más escenas ópticas cuando hay nubes y temperatura de superficie (estrés térmico) |
| **SMAP / ESA CCI Soil Moisture** (9–36 km) | Humedad de suelo independiente para validar el radar |
| **Estaciones INTA / SMN / sensores IoT en el lote** | Validación en tierra (ground truth) del oráculo: reduce el riesgo base |
| **Rindes históricos por departamento (MAGyP)** | Calibrar el índice de rendimiento contra cosechas reales |

### Límites a comunicar
- El NDVI se satura en canopeos densos (> 0,8) y no ve a través de nubes: por eso EVI, NDWI y radar.
- Lotes chicos (< 5 ha) tienen pocos píxeles de 10–20 m y más ruido.
- Las fuentes de clima son grillas de decenas de km: miden la zona, no el lote exacto (riesgo base del seguro paramétrico).
- Los umbrales (NDWI 0,05; 10 días críticos; 50% de lluvia) son de demo y deben calibrarse con datos de campañas reales.

## 2. Propuesta de negocio

### Problema
- El productor del NOA (poroto, tabaco, chía, garbanzo) se financia antes de sembrar con crédito caro, canje con acopiadores o capital propio.
- El seguro agrícola tradicional requiere peritos, es subjetivo y tarda meses en pagar.
- El inversor no tiene acceso directo a rendimientos agrícolas ni visibilidad del activo.

### Solución
Plataforma que tokeniza la **campaña productiva** de un lote (no el grano guardado). El token paga según datos satelitales y climáticos verificables, con un **seguro paramétrico embebido** que paga automáticamente ante sequía.

### Clientes
| Segmento | Qué obtiene |
|---|---|
| Productores medianos y cooperativas del NOA | Capital pre‑siembra sin banco, en semanas |
| Inversores minoristas y cripto (Argentina y LatAm) | Rendimiento en USDC respaldado por un activo real y monitoreado |
| Fondos / family offices | Exposición diversificada a cosechas con datos auditables |
| Aseguradoras y reaseguradoras | Oráculo de datos para productos paramétricos (B2B) |

### Modelo de ingresos (propuesto)
1. **Comisión de originación**: 1–2% del capital levantado por lote.
2. **Margen sobre la prima del seguro**: el pool cobra 3% del capital; parte cubre el riesgo y parte es ingreso.
3. **Fee de liquidación**: pequeño % sobre el repago al vencimiento.
4. **Oráculo como servicio (SaaS)**: API de riesgo hídrico por lote para aseguradoras, bancos y acopiadores.

### Ventaja diferencial
- Multifuente (óptico + radar + clima) → funciona en el verano nublado del NOA.
- Pago y seguro 100% automáticos on‑chain en Avalanche: sin peritos, en horas.
- Foco en cultivos aptos para RWA: fungibles, estandarizados y almacenables (ver página **Nosotros**).

### Alcance del MVP (hackathon)
- [x] Registro del lote por mapa o coordenadas, análisis satelital y climático real.
- [x] Token ERC‑20 por lote, inversión en MockUSDC, liberación al productor.
- [x] Oráculo on‑chain con NDVI/NDWI, balance hídrico, radar y trigger de seguro.
- [x] Liquidación y cobro automáticos; escenarios de demo (sequía / excelente).
- [ ] Deploy en Fuji / L1 propia, KYC real, calibración de umbrales con datos históricos.

### Métricas para validar
- Tiempo desde registro del lote hasta fondos recibidos.
- Tiempo desde evento de sequía hasta pago del seguro.
- % de escenas útiles por lote (cobertura óptica + radar).
- Error del índice de rendimiento contra rindes reales (backtesting de 5–10 campañas).

### Riesgos y próximos pasos
- **Regulatorio**: en Argentina la oferta de tokens a inversores requiere encuadre CNV (PSAV / régimen de tokenización). Validar con asesoría legal antes de cualquier piloto real.
- **Riesgo base**: la grilla climática no es el lote. Mitigar con CHIRPS, estaciones y sensores.
- **Repago del productor**: hoy depende de que deposite; en producción, garantías (warrant, cesión de cosecha) o acopiador como contraparte.
- **Oráculo centralizado**: migrar a multi‑firma o red de oráculos (p. ej. Chainlink Functions) y publicar el `dataHash` con los datos crudos.
- **Piloto sugerido**: 1 cooperativa de poroto en Salta, 3–5 lotes, una campaña, inversores de prueba en testnet.
