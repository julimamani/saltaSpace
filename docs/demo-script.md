# Guion de demo (3 minutos)

Preparación: `docker compose up --build`, wallet (Core/MetaMask) con la red local `http://localhost:8545` (chainId 31337) e importada la cuenta de Hardhat #0 (ver README). Abrir http://localhost:4000.

| Tiempo | Acción | Qué decir |
|---|---|---|
| 0:00 | Inicio: señalar el banner amarillo y las métricas. | "AgroToken tokeniza lotes agrícolas del norte argentino. Es un prototipo educativo en testnet: el activo es simulado, pero su comportamiento financiero depende de datos satelitales reales." |
| 0:20 | Conectar wallet → menú de la wallet → **Faucet +10.000 USDC**. | "Usamos USDC de prueba en Avalanche." |
| 0:35 | **Registrar lote** → "Usar lote de ejemplo" (o dibujar) → **Analizar lote**. | "El backend busca la escena Sentinel‑2 con menos nubes, recorta las bandas roja e infrarroja al polígono y calcula NDVI; suma lluvia y evapotranspiración de Open‑Meteo y NASA POWER. Sale un riesgo 0–100 y un índice de rendimiento." |
| 1:05 | **Crear lote on-chain** (plazos cortos de demo). Mostrar el toast con la tx. | "El polígono queda anclado on-chain con su hash; se crea un token ERC‑20 propio del lote." |
| 1:20 | En el detalle: invertir con **Máx** (aprobar + invertir). | "Los inversores compran fracciones; al completar la meta…" → **Liberar fondos al productor**. "…el productor recibe el capital antes de la siembra." |
| 1:50 | **Panel demo** → **Sequía**. Volver al detalle. | "El oráculo publica NDVI 0.22: por debajo de 0.30 el contrato aplica una penalización; el pago estimado cae por debajo del capital." Mostrar gráfico de evolución del pago. |
| 2:15 | **Panel demo** → **Cosecha excelente**. | "Con buen NDVI el pago sube hasta el techo de 1.3×." |
| 2:30 | Detalle → **Depositar repago** → **Liquidar** → **Cobrar**. | "En la cosecha, el contrato fija el pago con los datos del oráculo y cada inversor cobra quemando sus tokens." |
| 2:50 | Cierre: limitaciones. | "Para producción: marco CNV, KYC, oráculos descentralizados (Chainlink Functions) y auditoría." |

En Fuji los links de cada transacción abren Snowtrace testnet.
