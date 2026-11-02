// Envoltorio del LLM del arnés: registra cada llamada (tokens ×4, stop_reason, ms) y aplica el TOPE DURO
// de gasto. Opus 5.5 no tiene precio verificado (models.ts): sus llamadas no suman al tope en USD, así que
// el tope también limita el número de llamadas; quien conozca el precio verificado lo pasa en `prices`.

import { AdvisorBudgetError, costOf, type AdvisorLLM, type AdvisorRequest, type AdvisorResponse, type AdvisorStreamHandlers, type AdvisorUsage } from '../llm';
import type { CallRecord } from './types';

export interface PriceRow {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface Caps {
  /** Tope en USD sobre las llamadas con precio conocido. */
  maxUsd: number;
  /** Tope de llamadas (cubre los modelos sin precio). */
  maxCalls: number;
}

export class MeteredLLM implements AdvisorLLM {
  readonly calls: CallRecord[] = [];
  spentUsd = 0;
  unpriced = 0;
  /** Llamadas en vuelo: cuentan contra el tope de llamadas para que un abanico paralelo no lo desborde. */
  private inflight = 0;

  constructor(private readonly inner: AdvisorLLM, private readonly caps: Caps | null = null, private readonly prices: Record<string, PriceRow> = {}) {}

  private priceOf(model: string, u: AdvisorUsage): number | null {
    const p = this.prices[model];
    if (!p) return costOf(model, u);
    const M = 1_000_000;
    return (u.inputNew * p.input + u.cacheWrite5m * p.cacheWrite5m + u.cacheWrite1h * p.cacheWrite1h + u.cacheRead * p.cacheRead + u.output * p.output) / M;
  }

  private guardBefore(): void {
    if (!this.caps) return;
    if (this.calls.length + this.inflight >= this.caps.maxCalls) throw new AdvisorBudgetError(`tope de llamadas del arnés alcanzado (${this.caps.maxCalls})`);
    if (this.spentUsd >= this.caps.maxUsd) throw new AdvisorBudgetError(`tope de gasto del arnés alcanzado (${this.caps.maxUsd} USD)`);
  }

  private record(req: AdvisorRequest, res: AdvisorResponse): void {
    this.calls.push({ model: req.model, stopReason: res.stopReason, usage: res.usage, ms: res.ms });
    const c = this.priceOf(req.model, res.usage);
    if (c === null) this.unpriced++;
    else this.spentUsd += c;
  }

  async create(req: AdvisorRequest): Promise<AdvisorResponse> {
    this.guardBefore();
    this.inflight++;
    try {
      const res = await this.inner.create(req);
      this.record(req, res);
      return res;
    } finally {
      this.inflight--;
    }
  }

  async stream(req: AdvisorRequest, h?: AdvisorStreamHandlers): Promise<AdvisorResponse> {
    this.guardBefore();
    this.inflight++;
    try {
      const res = await this.inner.stream(req, h);
      this.record(req, res);
      return res;
    } finally {
      this.inflight--;
    }
  }

  /** USD solo si TODAS las llamadas tienen precio; si no, null (no se estima el precio que falta). */
  get costUsd(): number | null {
    return this.unpriced === 0 ? +this.spentUsd.toFixed(6) : null;
  }
}
