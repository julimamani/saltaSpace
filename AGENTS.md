# AGENTS.md

## Layout
- The entire app lives in `front/` (Angular 21, standalone + SSR). The repo root has only `README.md`.
- There is no root `package.json` or workspace. Run every npm/`ng` command from `front/`.
- No backend/API exists yet; `front/src/server.ts` only has a commented example endpoint.

## Commands (run in `front/`)
- `npm install` — npm 10.8.2, `package-lock.json` is committed.
- `npm start` (or `ng serve`) — dev server at http://localhost:4200, `development` config.
- `npm run build` (or `ng build`) — build to `dist/`. Note the default config is `production`, not development.
- `npm test` (or `ng test`) — Vitest + jsdom, **not** Karma/Jasmine.
  - Single file: `ng test --include src/app/app.spec.ts`
  - Single suite/test by name regex: `ng test --filter 'App'`
  - Watch mode defaults on in a TTY; use `ng test --no-watch` for a one-shot run.
- `node dist/front/server/server.mjs` (or `npm run serve:ssr:front`) — run the built SSR server. It listens on `PORT` (default 4000), not 4200.
- No lint script exists. Format with `npx prettier --write .`; config in `.prettierrc` (100 cols, single quotes, Angular parser for `*.html`).

## Conventions & gotchas
- SSR is enabled: `outputMode: server`, entry `src/main.server.ts`, Express handler in `src/server.ts`. `src/app/app.routes.server.ts` prerenders all routes (`RenderMode.Prerender`, path `**`).
- Tailwind CSS v4 is wired through `@tailwindcss/postcss`; `src/styles.css` uses `@import 'tailwindcss'`. There is no `tailwind.config` file (v4 is configured in CSS).
- TypeScript is `strict` with `strictTemplates`. `noPropertyAccessFromIndexSignature` is on, so index-signature access must use brackets (e.g. `process.env['PORT']`).
- Angular component prefix is `app`; use the CLI (`ng generate ...`) for scaffolding.
- Tests use Vitest globals — `describe`/`it`/`expect` need no import (`tsconfig.spec.json` includes `vitest/globals`).
