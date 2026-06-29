/**
 * Adaptador driven: implementa `IMonetizationService` sobre KV (binding MONET_KV).
 * Convierte fallos de I/O en `Err` tipado en el borde.
 *
 * SCAFFOLD del Paso 1 — la verificación real de suscripción / SDK se cablea luego.
 */
import { Ok, Err, type Result } from '@shared/result';
import type {
  IMonetizationService,
  Entitlement,
  MonetError,
} from '@/slices/monetization/domain/ports/IMonetizationService';
import type { KVNamespace } from '@cloudflare/workers-types';

const FREE_TIER: Entitlement = { premiumClub: false, ownedCosmetics: [] };

/** Type guard runtime: valida la forma del objeto deserializado desde KV. */
function isEntitlement(v: unknown): v is Entitlement {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['premiumClub'] === 'boolean' && Array.isArray(o['ownedCosmetics']);
}

export class KvMonetizationAdapter implements IMonetizationService {
  constructor(private readonly kv: KVNamespace) {}

  async getEntitlement(playerId: string): Promise<Result<Entitlement, MonetError>> {
    try {
      const raw: unknown = await this.kv.get(`ent:${playerId}`, 'json');
      // No confiar en el cast: validar la forma en la frontera I/O. Datos
      // ausentes o malformados ⇒ free tier (degradación segura).
      if (!isEntitlement(raw)) return Ok(FREE_TIER);
      return Ok(raw);
    } catch (e) {
      return Err({ kind: 'MonetizationUnavailable', cause: String(e) });
    }
  }

  async shouldSkipAds(playerId: string): Promise<Result<boolean, MonetError>> {
    const ent = await this.getEntitlement(playerId);
    return ent.ok ? Ok(ent.value.premiumClub) : ent;
  }
}
