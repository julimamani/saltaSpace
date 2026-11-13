# Deploy en una Avalanche L1 propia

Todo el stack es EVM-genérico: con el `chainId` y el RPC de tu L1 alcanza. La L1 puede
tener su propio gas token (no necesariamente AVAX) y corre `subnet-evm`.

## Pasos

1. **Creá la L1** con [Avalanche CLI](https://build.avax.network/docs/tooling/cli-commands)
   o Builder Hub y anotá `chainId`, RPC (`https://subnets.avax.network/<nombre>/testnet/rpc`
   o tu nodo `/ext/bc/<blockchainID>/rpc`) y el símbolo del gas token.
2. **Contratos**
   ```bash
   cd contracts
   cp .env.example .env
   # DEPLOYER_PRIVATE_KEY=0x...   (wallet con gas token de la L1)
   # L1_RPC_URL=https://...   L1_CHAIN_ID=<id>
   # COMPLIANCE_ADDRESS=0x...   (wallet que administra el KYC; default: deployer)
   # EVM_VERSION=shanghai       (solo si tu subnet-evm no soporta cancun)
   # USDC_ADDRESS=0x...         (opcional: ERC-20 existente en vez de MockUSDC)
   npm run deploy:l1     # deployments/l1.json + ABIs a front/ y backend/
   npm run seed:l1       # opcional: 2 lotes de ejemplo (skipea el faucet si USDC_ADDRESS)
   ```
3. **Backend** (`backend/.env`)
   ```bash
   CHAIN_NETWORK=l1        # debe coincidir con el nombre del archivo de deployments
   RPC_URL=https://<rpc-de-tu-l1>
   ORACLE_PRIVATE_KEY=0x...    # wallet con ORACLE_ROLE, con gas token
   EXPLORER_TX_URL=https://<tu-explorer>/tx/   # opcional; vacío = sin links (Snowtrace no indexa L1s custom)
   ```
4. **Front**: la L1 por defecto es la OrbiTag L1 (chainId 500301), definida en
   `DEFAULT_L1` de `front/src/app/core/config.ts`. Está en el código y no solo en
   `window` para que el prerender SSR y el browser resuelvan la misma red. El RPC va
   **proxied por el backend** (`POST /rpc` → `RPC_URL`): los RPC gestionados de AvaCloud
   no envían headers CORS y el browser bloquea las llamadas de viem
   ("Cross-Origin Request Blocked" / "HTTP request failed"). Además tienen rate limit
   (HTTP 429): el front agrupa las lecturas en batches y el proxy cachea lecturas
   ~3 s, limita la concurrencia y reintenta con backoff.
   Para apuntar a otra L1, cambiá `DEFAULT_L1` o agregá un `<script>` inline en
   `front/src/index.html` antes de `</body>` (solo aplica en el browser):
   ```html
   <script>
     window.AGRO_L1 = {
       chainId: 12345,                    // el chainId de tu L1
       rpcUrl: '/rpc',                     // proxy del backend (evita el bloqueo CORS)
       name: 'Salta L1',
       currencySymbol: 'SALT',            // gas token de la L1
       explorerUrl: 'https://<tu-explorer>',   // opcional (Blockscout, etc.)
       gasFaucetUrl: 'https://<tu-faucet>'     // opcional: dónde pedir gas
     };
   </script>
   ```
   Con eso la app resuelve la chain sola: si existe el deployment exportado de esa L1,
   pasa a ser la default (o forzala con `?chain=<chainId>`).
   El botón de la wallet agrega la red a MetaMask/Core vía `wallet_addEthereumChain`.

## Stablecoin en la L1

- **Mock (default)**: el deploy despliega `MockUSDC` (6 decimales, faucet público) como hoy.
- **Token existente**: `USDC_ADDRESS=0x...` usa ese ERC-20 como medio de pago del
  `CampaignVault` y marca `usdcIsMock: false` en el deployment — el front oculta el
  botón de faucet automáticamente. Debe tener **6 decimales** (`USDC_DECIMALS` en
  `front/src/app/core/config.ts`).
- **USDC real bridged**: para traer USDC nativo de C-Chain usá
  [ICTT / Teleporter](https://build.avax.network/docs/avalanche-l1s/interchain-token-transfer):
  un `TokenHome` en C-Chain sobre USDC y un `TokenRemote` en tu L1; después deployás con
  `USDC_ADDRESS` apuntando al token remote.

## KYC / token RWA

El deploy incluye `InvestorRegistry`: solo wallets verificadas pueden recibir `LotToken`
(invertir o recibir transferencias). `COMPLIANCE_ROLE` lo tiene el deployer y
`COMPLIANCE_ADDRESS`. Para la demo, un compliance se auto-verifica desde el menú de la
wallet en el front ("Verificar mi wallet"), o por CLI:
`cast send <InvestorRegistry> "setInvestor(address,bool)" <wallet> true --rpc-url $L1_RPC_URL`.

## Notas

- El gas de deploy y del oráculo se paga con el gas token nativo de la L1; distribuilo
  vos al deployer, al oráculo y a los inversores de la demo.
- Si tu L1 no tiene explorer público, levantá un Blockscout o dejá `explorerUrl` vacío
  (los links de tx simplemente no se muestran).
- `evmVersion: cancun` es el default; subnet-evm antiguos pueden requerir
  `EVM_VERSION=shanghai` (o `paris`) para compilar bytecode compatible.
