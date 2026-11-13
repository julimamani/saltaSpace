# AGENTS.md

## Layout
- `front/` — Angular 21 (standalone + SSR), viem, Tailwind v4.
- `backend/` — Python 3.11 FastAPI: satellite/weather analytics, oracle + scheduler, SQLite history and a JSON-RPC proxy (`POST /rpc`, `app/routers/rpc.py`) used by the front.
- `contracts/` — Solidity 0.8.24 + Hardhat (TypeScript). Deploy scripts export ABIs/addresses to `front/src/app/web3/generated/` and `backend/app/chain/`.
- `docs/` — scoring, insurance, deploy (Fuji / L1) and demo docs. `docker-compose.yml` at the root.
- There is no root `package.json` or workspace. Run npm commands from `front/` or `contracts/`.

## Networks
- Default target: OrbiTag Avalanche L1 (chainId 500301, AvaCloud managed). Deployment in `contracts/deployments/l1.json`; front default in `front/src/app/core/config.ts` (`DEFAULT_L1`, overridable with `window.AGRO_L1`).
- Local Hardhat (31337): `docker compose --profile local up -d --build` with the localhost env vars (see `docker-compose.yml`), front with `?chain=31337`.
- The managed RPC is rate limited (HTTP 429). The front batches viem reads and the `/rpc` proxy caches/retries; avoid adding high-frequency polling.
- Never commit `.env` files (they hold deployer/oracle private keys).

## Commands
- Front (`front/`): `npm install`, `npm start` (http://localhost:4200), `npm run build` (default config is `production`), `npm test` (Vitest + jsdom, not Karma; `ng test --no-watch` for a one-shot run), `npm run serve:ssr:front` (SSR server on `PORT`, default 4000).
- Backend (`backend/`): `pip install -r requirements-dev.txt`, `pytest`, `uvicorn app.main:app --reload --port 8000`. Config via `backend/.env` (see `.env.example`).
- Contracts (`contracts/`): `npm test`, `npm run deploy:local|deploy:fuji|deploy:l1`, `npm run seed:<network>`.
- No lint script exists in the front. Format with `npx prettier --write .`; config in `.prettierrc` (100 cols, single quotes, Angular parser for `*.html`).

## Conventions & gotchas
- SSR is enabled: `outputMode: server`, entry `src/main.server.ts`, Express handler in `src/server.ts`. `src/app/app.routes.server.ts` prerenders `/` and `/nosotros`; `window` is not available there, so chain config must not depend on `window` alone.
- Tailwind CSS v4 is wired through `@tailwindcss/postcss`; `src/styles.css` uses `@import 'tailwindcss'`. There is no `tailwind.config` file.
- TypeScript is `strict` with `strictTemplates`. `noPropertyAccessFromIndexSignature` is on, so index-signature access must use brackets (e.g. `process.env['PORT']`).
- Angular component prefix is `app`; use the CLI (`ng generate ...`) for scaffolding.
- Tests use Vitest globals — `describe`/`it`/`expect` need no import (`tsconfig.spec.json` includes `vitest/globals`).
