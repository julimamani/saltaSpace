# Guion de demo (3 minutos)

Preparación: `docker compose up --build`, wallet (Core/MetaMask) con la red local `http://localhost:8545` (chainId 31337) e importada la cuenta de Hardhat #0 (ver README). Abrir http://localhost:4000.

| Tiempo | Acción | Qué decir |
|---|---|---|
| 0:00 | Inicio: señalar el banner amarillo y las métricas. | "OrbiTag tokeniza lotes agrícolas del norte argentino. Es un prototipo educativo en testnet: el activo es simulado, pero su comportamiento financiero depende de datos satelitales reales." |
| 0:20 | Conectar wallet → menú de la wallet → **Faucet +10.000 USDC**. | "Usamos USDC de prueba en Avalanche." |
| 0:35 | **Registrar lote** → "Usar lote de ejemplo" (o dibujar) → **Analizar lote**. | "El backend toma la mejor escena Sentinel‑2 de cada semana y calcula NDVI, EVI y NDWI (agua en hoja); lee el radar Sentinel‑1, que atraviesa nubes; y arma el balance hídrico con ET0 Penman‑Monteith × Kc del cultivo contra la lluvia real y el histórico. Sale un riesgo 0–100, un índice de rendimiento y la evaluación del seguro." |
| 1:05 | **Crear lote on-chain** (plazos cortos de demo). Mostrar el toast con la tx. | "El polígono queda anclado on-chain con su hash; se crea un token ERC‑20 propio del lote." |
| 1:20 | En el detalle: invertir con **Máx** (aprobar + invertir). | "Los inversores compran fracciones; al completar la meta…" → **Liberar fondos al productor**. "…el productor recibe el capital antes de la siembra." |
| 1:50 | **Panel demo** → **Sequía**. Volver al detalle. | "El oráculo publica NDVI 0.22, NDWI −0.15, lluvia al 15% del histórico y radar con suelo seco: el contrato aplica la penalización de sequía y el **trigger del seguro paramétrico** se activa solo." Mostrar la tarjeta del seguro (condiciones en rojo) y el gráfico del balance hídrico. |
| 2:05 | **Ejecutar cobertura** en la tarjeta del seguro. | "Sin perito: cualquiera puede ejecutar la cobertura; el pool paga el 20% del capital del lote a los inversores. En producción, lo haría `settle()` automáticamente." |
| 2:15 | **Panel demo** → **Cosecha excelente**. | "Con buen NDVI el pago sube hasta el techo de 1.3×." |
| 2:30 | Detalle → **Depositar repago** → **Liquidar** → **Cobrar**. | "En la cosecha, el contrato fija el pago con los datos del oráculo y cada inversor cobra quemando sus tokens." |
| 2:50 | Cierre: limitaciones. | "Para producción: marco CNV, KYC, oráculos descentralizados (Chainlink Functions) y auditoría." |

En Fuji los links de cada transacción abren Snowtrace testnet.
