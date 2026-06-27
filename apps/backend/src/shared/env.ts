/**
 * Tipos de los bindings del Worker (Env). Espejo de los bindings de wrangler.jsonc.
 *
 * En cuanto se ejecute `pnpm cf-typegen` (= `wrangler types`), Cloudflare genera
 * `worker-configuration.d.ts` con un `Env` global derivado de wrangler.jsonc; este
 * archivo es el placeholder hasta entonces (y documenta qué hay disponible).
 */
import type {
  DurableObjectNamespace,
  KVNamespace,
  R2Bucket,
} from '@cloudflare/workers-types';

export interface Env {
  /** Una instancia de GameRoomDO por sala de juego. */
  GAME_ROOM: DurableObjectNamespace;
  /** Entitlements / suscripción "Premium Club" (slice monetization). */
  MONET_KV: KVNamespace;
  /** Texturas/cosméticos premium custom. */
  COSMETICS_R2: R2Bucket;
  TICK_HZ: string;
  MAX_PLAYERS_PER_ROOM: string;
}
