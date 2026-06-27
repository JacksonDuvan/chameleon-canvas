/**
 * Adaptador driven para cosméticos premium: lee texturas/skins custom desde R2
 * (binding COSMETICS_R2). Sirve la carga de texturas premium de la tienda.
 *
 * SCAFFOLD del Paso 1.
 */
import { Ok, Err, type Result } from '@shared/result';
import type { MonetError } from '@/slices/monetization/domain/ports/IMonetizationService';
import type { R2Bucket } from '@cloudflare/workers-types';

export class R2CosmeticsAdapter {
  constructor(private readonly bucket: R2Bucket) {}

  /** Devuelve el objeto de textura premium (o null si no existe). */
  async getTexture(key: string): Promise<Result<ArrayBuffer | null, MonetError>> {
    try {
      const obj = await this.bucket.get(`cosmetics/${key}`);
      return Ok(obj ? await obj.arrayBuffer() : null);
    } catch (e) {
      return Err({ kind: 'MonetizationUnavailable', cause: String(e) });
    }
  }
}
