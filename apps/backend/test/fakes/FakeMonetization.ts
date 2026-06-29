/**
 * Fake en memoria de `IMonetizationService`. Implementa el puerto real (LSP) para
 * probar PlayerJoin sin SDKs externos. Skill `tdd-testing`.
 */
import { Ok, type Result } from '@shared/result';
import type {
  IMonetizationService,
  Entitlement,
  MonetError,
} from '@/slices/monetization/domain/ports/IMonetizationService';

export class FakeMonetization implements IMonetizationService {
  private readonly premiumIds: Set<string>;

  constructor(premiumIds: Iterable<string> = []) {
    this.premiumIds = new Set(premiumIds);
  }

  setPremium(id: string): void {
    this.premiumIds.add(id);
  }

  async getEntitlement(playerId: string): Promise<Result<Entitlement, MonetError>> {
    return Ok({ premiumClub: this.premiumIds.has(playerId), ownedCosmetics: [] });
  }

  async shouldSkipAds(playerId: string): Promise<Result<boolean, MonetError>> {
    return Ok(this.premiumIds.has(playerId));
  }
}
