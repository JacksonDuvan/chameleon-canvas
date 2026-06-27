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

export class KvMonetizationAdapter implements IMonetizationService {
  constructor(private readonly kv: KVNamespace) {}

  async getEntitlement(playerId: string): Promise<Result<Entitlement, MonetError>> {
    try {
      const raw = await this.kv.get(`ent:${playerId}`, 'json');
      return Ok((raw as Entitlement | null) ?? FREE_TIER);
    } catch (e) {
      return Err({ kind: 'MonetizationUnavailable', cause: String(e) });
    }
  }

  async shouldSkipAds(playerId: string): Promise<Result<boolean, MonetError>> {
    const ent = await this.getEntitlement(playerId);
    return ent.ok ? Ok(ent.value.premiumClub) : ent;
  }
}
