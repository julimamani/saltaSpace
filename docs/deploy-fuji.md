# Deploy en Avalanche Fuji

| Dato | Valor |
|---|---|
| Red | Avalanche Fuji C-Chain |
| Chain ID | 43113 |
| RPC | https://api.avax-test.network/ext/bc/C/rpc |
| Explorer | https://testnet.snowtrace.io |
| Faucet AVAX | https://core.app/tools/testnet-faucet/?subnet=c&token=c |

## Pasos

1. **Wallets**: creá una wallet de testnet para el deployer (y opcionalmente otra para el oráculo). Pedí AVAX de test en el faucet (gas para ~10 transacciones de deploy + publicaciones del oráculo).
2. **Contratos**
   ```bash
   cd contracts
   cp .env.example .env    # DEPLOYER_PRIVATE_KEY=0x...  ORACLE_ADDRESS=0x... (opcional)
   npm install
   npm test
   npm run deploy:fuji     # deployments/fuji.json + ABIs a front/ y backend/
   npm run seed:fuji       # opcional: 2 lotes de ejemplo
   ```
   El deployer queda como admin (`DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE`, `SETTLER_ROLE`) y `ORACLE_ADDRESS` recibe `ORACLE_ROLE`.
3. **Backend**
   ```bash
   cd backend
   cp .env.example .env
   # CHAIN_NETWORK=fuji
   # RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
   # ORACLE_PRIVATE_KEY=0x...   (la wallet de ORACLE_ADDRESS, con AVAX de test)
   uvicorn app.main:app --port 8000
   curl -X POST localhost:8000/oracle/push/0
   ```
4. **Front**: al existir `fuji` en `front/src/app/web3/generated/deployments.ts`, la app usa Fuji por defecto (`?chain=31337` vuelve a local). El botón de la wallet agrega/cambia a Fuji y ofrece el faucet de USDC de prueba.
5. **Verificación opcional** en Snowtrace: `npx hardhat verify --network fuji <address> <args>` (requiere configurar la API key del explorer).

## Notas

- Fuji no permite adelantar el tiempo: para la demo creá lotes con "plazos cortos (minutos)" en el formulario o liquidá con la cuenta admin (`SETTLER_ROLE`).
- El RPC público limita el rango de `eth_getLogs`; el front lee eventos desde el bloque de deploy y, si falla, recorre ventanas de 2.000 bloques recientes.
- Nunca commitees `.env` ni claves privadas.
