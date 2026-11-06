/**
 * Adaptador de IRoomRegistry sobre Cloudflare KV.
 *
 * - `exists`: get por clave (des-duplicación de códigos al crear).
 * - `register`: put con `expirationTtl` (la sala sale del LISTADO tras 1 h de
 *   vida; el DO sigue existiendo y el código sigue siendo válido para unirse —
 *   el listado es solo conveniencia, la verdad vive en el DO).
 * - `list`: `list({prefix})` + metadata (evita un `get` por sala). Metadata de KV
 *   viaja con la clave ⇒ listado en una sola llamada por página.
 *
 * Skill `hexagonal-vertical-slicing`: adaptador FINO — convierte I/O en
 * `Result` (los `try/catch` viven solo aquí, en el borde). Camino FRÍO:
 * crear/unirse/listar ocurre una vez por sala, no por tick.
 */
import { Ok, Err, type Result } from '@shared/result';
import type { KVNamespace, KVNamespaceListResult } from '@cloudflare/workers-types';
import type { MatchmakingError } from '../../domain/errors';
import type {
  IRoomRegistry,
  RoomRegistration,
  RoomSummary,
} from '../../domain/ports/IRoomRegistry';

const PREFIX = 'room:';
/** Ventana de listado (s). KV exige >=60 s. La sala en el DO vive más allá del listado. */
const LISTED_TTL_S = 3600;

export class KvRoomRegistry implements IRoomRegistry {
  constructor(private readonly kv: KVNamespace) {}

  async exists(roomId: string): Promise<Result<boolean, MatchmakingError>> {
    try {
      const value = await this.kv.get(PREFIX + roomId);
      return Ok(value !== null);
    } catch (cause) {
      return Err({ kind: 'RegistryError', cause: String(cause) });
    }
  }

  async register(meta: RoomRegistration): Promise<Result<void, MatchmakingError>> {
    try {
      await this.kv.put(PREFIX + meta.roomId, 'active', {
        expirationTtl: LISTED_TTL_S,
        // La metadata viaja con la clave: `list` no necesita un get por sala.
        metadata: { roomId: meta.roomId, hostName: meta.hostName, createdAt: Date.now() },
      });
      return Ok(undefined);
    } catch (cause) {
      return Err({ kind: 'RegistryError', cause: String(cause) });
    }
  }

  async list(): Promise<Result<readonly RoomSummary[], MatchmakingError>> {
    try {
      const out: RoomSummary[] = [];
      let cursor: string | null = null;
      // Paginación con cota defensiva (KV devuelve ~1000 claves por página).
      for (let page = 0; page < 100; page++) {
        // Anotación explícita: rompe la inferencia circular cursor↔res.cursor de
        // las sobrecargas de list() (TS7022 con exactOptionalPropertyTypes).
        const res: KVNamespaceListResult<unknown, string> = await this.kv.list({
          prefix: PREFIX,
          cursor,
        });
        for (const key of res.keys) {
          const meta = key.metadata as Partial<RoomSummary> | null | undefined;
          if (meta && typeof meta.roomId === 'string' && typeof meta.hostName === 'string' && typeof meta.createdAt === 'number') {
            out.push({ roomId: meta.roomId, hostName: meta.hostName, createdAt: meta.createdAt });
          }
        }
        if (res.list_complete) break;
        cursor = res.cursor;
      }
      return Ok(out);
    } catch (cause) {
      return Err({ kind: 'RegistryError', cause: String(cause) });
    }
  }
}
