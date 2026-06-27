# 🦎 Meccha Chameleon Clone

Clon web 3D online inspirado en **Meccha Chameleon** (esconderse y buscar
camuflándose en un escenario 3D), desplegable íntegramente en **Cloudflare**.

- **Backend autoritativo:** Hono · Cloudflare **Workers** + **Durable Objects** · WebSockets
- **Frontend:** **TanStack Start** · **React Three Fiber** · **Zustand** (vanilla)
- **Monorepo:** TypeScript · **pnpm workspaces** · Node **24**

```
packages/shared   contratos de red (Result, protocolo WS, esquemas Hono RPC)
packages/sim      kernel de simulación DETERMINISTA compartido (server + cliente)
apps/backend      Worker Hono + Durable Objects (GameRoomDO)
apps/frontend     cliente TanStack Start + R3F
```

## Empezar

```bash
nvm use            # Node 24 (.nvmrc)
pnpm install
pnpm dev           # backend (wrangler) + frontend (vite) en paralelo
```

## Documentación

- **[`CLAUDE.md`](CLAUDE.md)** — guía de arquitectura, convenciones e índice de las 5 skills.
- **[`docs/`](docs/)** — contexto entre sesiones: prompt fundacional y registro por pasos.

> Estado: **Paso 1 (scaffolding) completado.** Ver
> [`docs/01-step-1-monorepo-setup.md`](docs/01-step-1-monorepo-setup.md).
