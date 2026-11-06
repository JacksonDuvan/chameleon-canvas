# 19 · Paso 16 — V1-I: deploy a producción (backend + frontend en el edge)

> Épica **V1-I** del charter ([`docs/09`](09-v1-scope.md), backlog P4.3). "Hecho
> cuando": **desplegado en el edge, jugable desde una URL, sin descargas** —
> verificado con E2E de 2 navegadores contra las URLs reales (§Verificación).

## URLs de producción

| Pieza | URL |
|---|---|
| Backend (Worker + DO + KV) | https://chameleon-canvas-backend.jzambranogarzon.workers.dev |
| Frontend (TanStack Start SSR + assets) | https://chameleon-canvas.jzambranogarzon.workers.dev |

## Qué se hizo

1. **Namespace KV real**: `wrangler kv namespace create ROOMS_KV` ⇒ id
   `3ff938bfb0e84197aca638e4c11441c9` en `wrangler.jsonc` (antes placeholder
   local). Mismo proceso que MONET_KV en su día.
2. **Backend**: `wrangler deploy` (258 KiB / 55 KiB gzip, startup 6 ms) con los
   tres bindings: `GAME_ROOM` (DO SQLite), `MONET_KV`, `ROOMS_KV`.
3. **Frontend**: `vite build` con `.env.production` (las `VITE_API_URL`/`VITE_WS_URL`
   se inyectan en BUILD time — ya apuntaban al backend correcto) +
   `wrangler deploy -c dist/server/wrangler.json` (841 KiB / 167 KiB gzip).
4. **Smoke test HTTP del edge**: health ✓ · crear sala ⇒ código Crockford ✓ ·
   pre-flight `status` ✓ · listado KV con metadata ✓ · CORS reflejando el Origin ✓.

## Verificación jugable en el edge (definition of done de V1)

E2E de 2 navegadores headless contra las URLs REALES (sin hooks dev: la fase se
valida por el HUD, la conectividad por la cuenta atrás derivada de `serverTick`):

- [x] A crea sala ⇒ código válido visible y compartible.
- [x] B se une POR CÓDIGO y ambos se ven en el lobby.
- [x] A (host) ve "Empezar"; B espera al host.
- [x] Código inválido se rechaza en la UI sin salir del formulario.
- [x] Host inicia ⇒ fase `prep` en ambos + cuenta atrás corriendo (⇒ snapshots
      del DO fluyen por WebSocket en el edge).

**Resultado: 8/8 verificaciones.** La sala de producción crea salas de verdad en
KV, los Durable Objects aceptan upgrades WS desde el navegador público, y el
pre-flight responde antes de conectar.

## Operación y notas

- **CI/CD ya activo** (`.github/workflows/deploy.yml`): en cada push a `main`
  corre lint+typecheck+tests y despliega backend→frontend (secrets
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_API_URL`, `VITE_WS_URL`).
  Este deploy manual de Paso 16 deja la pauta; los siguientes van solos por CI.
- Las salas del listado KV viven 1 h (TTL): las salas de humo del test
  desaparecen solas; el DO de una sala sigue siendo unible por código siempre.
- El token de wrangler local había expirado; se renovó con `wrangler login`.
- Siguientes mejoras post-V1 (P4.3+): dominio propio (route custom), observabilidad
  (P4.4: `wrangler tail`, métricas de sala/tick), y rate-limit del pre-flight.

## Definición de "listo para lanzar" (docs/09 §7) — estado final

- [x] Dos+ navegadores entran por código a la misma sala (nombre propio) y juegan
      una ronda lobby → prep → hunt → results con reveal.
- [x] El Hider camuflado+posado+quieto entre props no es detectado (núcleo V1-A/B/C/D).
- [x] El Seeker caza en 1ª persona apuntando con el ratón.
- [x] Se ve como un juego (pass V1-G).
- [x] Desplegado en el edge, jugable desde una URL, sin descargas.
- [x] `pnpm test` · `test:do` · `typecheck` · `lint` en verde; smoke multi-cliente
      en el edge 8/8.

**V1 está desplegada y jugable.** Pendiente humano: el playtest de balance
(V1-D) con gente real.
