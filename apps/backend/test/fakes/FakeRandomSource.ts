/**
 * Fake de IRandomSource: cola de byte-sets controlable (para tests de colisión)
 * con fallback determinista a un contador (para tests de estrés con miles de
 * códigos únicos). Skill `tdd-testing`.
 */
import type { IRandomSource } from '../../src/slices/matchmaking/domain/ports/IRandomSource';

export class FakeRandomSource implements IRandomSource {
  private readonly scripted: Uint8Array[];
  private alwaysBytes: Uint8Array | null = null;
  private counter = 0;

  constructor(scripted: Uint8Array[] = []) {
    this.scripted = [...scripted];
  }

  /** Fuerza que TODAS las llamadas devuelvan estos bytes (colisiones seguras). */
  static always(bytes: Uint8Array): FakeRandomSource {
    const fake = new FakeRandomSource();
    fake.alwaysBytes = bytes;
    return fake;
  }

  bytes(n: number): Uint8Array {
    if (this.alwaysBytes) return this.alwaysBytes;
    const next = this.scripted.shift();
    if (next) return next;
    // Fallback: contador incremental ⇒ códigos únicos y deterministas.
    this.counter++;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = (this.counter >> (i * 5)) & 0xff;
    return out;
  }
}
