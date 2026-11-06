/**
 * Adaptador de IRandomSource: entropía criptográfica del runtime
 * (`crypto.getRandomValues`, disponible en Workers y Node 24).
 *
 * El dominio sigue siendo determinista: este es el BORDE que inyecta azar
 * (skill `hexagonal-vertical-slicing`; el código de sala no es estado de sim).
 */
import type { IRandomSource } from '../../domain/ports/IRandomSource';

export class CryptoRandomSource implements IRandomSource {
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
  }
}
