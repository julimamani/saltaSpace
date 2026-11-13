# Guion de demo (3 minutos)

Preparación (OrbiTag L1, chainId 500301): `ORACLE_PRIVATE_KEY` en `.env` y `docker compose up -d --build`. Abrir http://localhost:4000 y, desde el botón de la wallet (Core/MetaMask), agregar la red OrbiTag L1; la wallet necesita gas token de la L1. Para la demo local con Hardhat (chainId 31337) ver la sección "Red local" del README (`docker compose --profile local up -d --build`, cuenta Hardhat #0 y `?chain=31337`).

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

Los links de cada transacción abren el explorador de la red si hay uno configurado (Snowtrace en Fuji, `explorerUrl` / `EXPLORER_TX_URL` en la L1); si no, se muestra el hash.
