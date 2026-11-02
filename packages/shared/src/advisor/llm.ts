// Capa LLM del asesor (spec §5.1–§5.2). Backend `runtime`: bedrock-runtime con los
// perfiles us.*. El cliente se inyecta (`send`) como en bedrock.ts; el comando del
// SDK se importa en dinámico para no empaquetarlo en apps/web.

import { ADVISOR_PRICING, type AdvisorEffort } from './models';

// ---- Tipos de mensaje --------------------------------------------------------

export interface CacheControl {
  type: 'ephemeral';
  ttl?: '5m' | '1h';
}

export type AdvisorContentBlock =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  // Thinking se devuelve tal cual en el historial (spec §5.2 regla 5); nunca se muestra.
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; cache_control?: CacheControl };

export interface AdvisorMessage {
  /** `system` a mitad de conversación (spec §5.2 regla 5): aviso del harness, nunca dentro de un tool_result. */
  role: 'user' | 'assistant' | 'system';
  content: string | AdvisorContentBlock[];
}

export interface AdvisorTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Herramientas estrictas (spec §5.2 regla 2). */
  strict: true;
}

export interface AdvisorRequest {
  model: string;
  effort: AdvisorEffort;
  maxTokens: number;
  system?: AdvisorContentBlock[];
  messages: AdvisorMessage[];
  tools?: AdvisorTool[];
  /** Salida estructurada (spec §5.2 regla 2): JSON Schema validado por el servicio. */
  outputSchema?: Record<string, unknown>;
  /** Cancelación (spec §8.4): aborta la petición en curso. No viaja en el cuerpo. */
  signal?: AbortSignal;
}

export interface AdvisorUsage {
  inputNew: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface AdvisorResponse {
  model: string;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'stop_sequence' | 'pause_turn' | string;
  content: AdvisorContentBlock[];
  usage: AdvisorUsage;
  ms: number;
}

export interface AdvisorStreamHandlers {
  onTextDelta?: (text: string) => void;
}

export interface AdvisorLLM {
  create(req: AdvisorRequest): Promise<AdvisorResponse>;
  stream(req: AdvisorRequest, handlers?: AdvisorStreamHandlers): Promise<AdvisorResponse>;
}

// ---- Reglas de request (spec §5.2) -------------------------------------------

const FORBIDDEN_SAMPLING = ['temperature', 'top_p', 'top_k'] as const;

/**
 * Cuerpo de la API de Messages, ya armado. Lanza si viola las reglas del módulo:
 * sampling explícito o `tool_choice` forzado. Se usa en todo envío.
 */
export function assertAdvisorRequestRules(body: Record<string, unknown>): void {
  for (const k of FORBIDDEN_SAMPLING) {
    if (k in body) throw new Error(`advisor: request con "${k}" prohibido (spec §5.2)`);
  }
  const tc = body.tool_choice as { type?: string } | undefined;
  if (tc && (tc.type === 'any' || tc.type === 'tool')) {
    throw new Error(`advisor: tool_choice forzado "${tc.type}" prohibido (spec §5.2)`);
  }
}

/** Cuerpo de bedrock-runtime (formato Anthropic Messages). Sin temperature ni tool_choice. */
export function buildRuntimeBody(req: AdvisorRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: req.maxTokens,
    output_config: { effort: req.effort },
    // Resumen, no `updates`: el beta de updates no entrega texto (investigacion/13, V4).
    thinking: { type: 'adaptive', display: 'summarized' },
    messages: req.messages,
  };
  if (req.system?.length) body.system = req.system;
  if (req.tools?.length) body.tools = req.tools;
  if (req.outputSchema) {
    body.output_config = { effort: req.effort, format: { type: 'json_schema', schema: req.outputSchema } };
  }
  assertAdvisorRequestRules(body);
  return body;
}

// ---- Libro de tokens (spec §5.2 regla 7) -------------------------------------

export class AdvisorBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdvisorBudgetError';
  }
}

export class TokenLedger {
  private totals: AdvisorUsage = { inputNew: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 };
  private costUsd = 0;
  private costKnown = true;
  readonly calls: Array<{ model: string; stopReason: string; usage: AdvisorUsage; ms: number }> = [];

  constructor(private readonly expectedCostUsd: number, private readonly abortFactor = 3) {}

  add(model: string, res: AdvisorResponse): void {
    const u = res.usage;
    this.totals = {
      inputNew: this.totals.inputNew + u.inputNew,
      cacheWrite5m: this.totals.cacheWrite5m + u.cacheWrite5m,
      cacheWrite1h: this.totals.cacheWrite1h + u.cacheWrite1h,
      cacheRead: this.totals.cacheRead + u.cacheRead,
      output: this.totals.output + u.output,
    };
    this.calls.push({ model: res.model, stopReason: res.stopReason, usage: u, ms: res.ms });
    const cost = costOf(model, u);
    if (cost === null) this.costKnown = false;
    else this.costUsd += cost;
    if (this.expectedCostUsd > 0 && this.costUsd > this.expectedCostUsd * this.abortFactor) {
      throw new AdvisorBudgetError(
        `error_budget: costo ${this.costUsd.toFixed(4)} USD > ${this.abortFactor}× el esperado (${this.expectedCostUsd.toFixed(4)})`,
      );
    }
  }

  snapshot(): { usage: AdvisorUsage; costUsd: number | null } {
    return { usage: { ...this.totals }, costUsd: this.costKnown ? +this.costUsd.toFixed(6) : null };
  }
}

/** Costo de una llamada en USD, o null si el modelo no tiene precio verificado en la tabla. */
export function costOf(model: string, u: AdvisorUsage): number | null {
  const p = ADVISOR_PRICING.models[model];
  if (!p) return null;
  const M = 1_000_000;
  return (
    (u.inputNew * p.input) / M +
    (u.cacheWrite5m * p.cacheWrite5m) / M +
    (u.cacheWrite1h * p.cacheWrite1h) / M +
    (u.cacheRead * p.cacheRead) / M +
    (u.output * p.output) / M
  );
}

// ---- Implementación runtime --------------------------------------------------

/** Cliente estructural: el caller pasa su BedrockRuntimeClient. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BedrockClientLike = { send: (cmd: any, options?: { abortSignal?: AbortSignal }) => Promise<any> };

type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

function toUsage(raw: RawUsage | undefined): AdvisorUsage {
  const w5 = raw?.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const w1 = raw?.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const writeTotal = raw?.cache_creation_input_tokens ?? 0;
  return {
    inputNew: raw?.input_tokens ?? 0,
    cacheWrite5m: w5,
    // Si no viene el desglose, el total de escritura se cuenta como 1 h (la familia A/B lo usa así).
    cacheWrite1h: w5 + w1 === 0 ? writeTotal : w1,
    cacheRead: raw?.cache_read_input_tokens ?? 0,
    output: raw?.output_tokens ?? 0,
  };
}

export class RuntimeLLM implements AdvisorLLM {
  constructor(private readonly client: BedrockClientLike) {}

  async create(req: AdvisorRequest): Promise<AdvisorResponse> {
    const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const t0 = Date.now();
    const out = await this.client.send(
      new InvokeModelCommand({
        modelId: req.model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(buildRuntimeBody(req)),
      }),
      req.signal ? { abortSignal: req.signal } : undefined,
    );
    const r = JSON.parse(Buffer.from(out.body).toString('utf8'));
    return {
      model: r.model ?? req.model,
      stopReason: r.stop_reason ?? 'end_turn',
      content: r.content ?? [],
      usage: toUsage(r.usage),
      ms: Date.now() - t0,
    };
  }

  async stream(req: AdvisorRequest, handlers: AdvisorStreamHandlers = {}): Promise<AdvisorResponse> {
    const { InvokeModelWithResponseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const t0 = Date.now();
    const out = await this.client.send(
      new InvokeModelWithResponseStreamCommand({
        modelId: req.model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(buildRuntimeBody(req)),
      }),
      req.signal ? { abortSignal: req.signal } : undefined,
    );

    // Acumuladores por índice de bloque.
    const blocks: Array<{ type: string; text?: string; id?: string; name?: string; json?: string; signature?: string }> = [];
    let usage: RawUsage = {};
    let stopReason = 'end_turn';
    let model = req.model;

    for await (const chunk of out.body) {
      if (!chunk.chunk) continue;
      const ev = JSON.parse(Buffer.from(chunk.chunk.bytes).toString('utf8'));
      switch (ev.type) {
        case 'message_start':
          model = ev.message?.model ?? model;
          usage = { ...usage, ...(ev.message?.usage ?? {}) };
          break;
        case 'content_block_start': {
          const cb = ev.content_block;
          blocks[ev.index] = { type: cb.type, text: cb.text ?? '', id: cb.id, name: cb.name, json: '' };
          break;
        }
        case 'content_block_delta': {
          const b = blocks[ev.index];
          if (!b) break;
          if (ev.delta?.type === 'text_delta') {
            b.text = (b.text ?? '') + ev.delta.text;
            handlers.onTextDelta?.(ev.delta.text);
          } else if (ev.delta?.type === 'input_json_delta') {
            b.json = (b.json ?? '') + ev.delta.partial_json;
          } else if (ev.delta?.type === 'thinking_delta') {
            b.text = (b.text ?? '') + ev.delta.thinking;
          } else if (ev.delta?.type === 'signature_delta') {
            b.signature = (b.signature ?? '') + ev.delta.signature;
          }
          break;
        }
        case 'message_delta':
          stopReason = ev.delta?.stop_reason ?? stopReason;
          usage = { ...usage, ...(ev.usage ?? {}) };
          break;
        default:
          break;
      }
    }

    const content: AdvisorContentBlock[] = blocks.filter(Boolean).map((b): AdvisorContentBlock => {
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id!, name: b.name!, input: b.json ? JSON.parse(b.json) : {} };
      if (b.type === 'thinking') return { type: 'thinking', thinking: b.text ?? '', signature: b.signature ?? '' };
      return { type: 'text', text: b.text ?? '' };
    });

    return { model, stopReason, content, usage: toUsage(usage), ms: Date.now() - t0 };
  }
}

// ---- Salida estructurada -------------------------------------------------------

export class AdvisorStructuredError extends Error {
  constructor(message: string, readonly stopReason: string) {
    super(message);
    this.name = 'AdvisorStructuredError';
  }
}

/**
 * JSON de una respuesta con `outputSchema`. Lanza si la respuesta no fue `end_turn`
 * (refusal o max_tokens, spec §5.2 regla 4) o si el texto no es JSON. El caller valida
 * el contenido contra su esquema con los validadores de schemas.ts.
 */
export function structuredJson(res: AdvisorResponse): unknown {
  if (res.stopReason !== 'end_turn') {
    throw new AdvisorStructuredError(`salida estructurada interrumpida: ${res.stopReason}`, res.stopReason);
  }
  const text = res.content
    .filter((b): b is Extract<AdvisorContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new AdvisorStructuredError('la salida estructurada no es JSON válido', res.stopReason);
  }
}
