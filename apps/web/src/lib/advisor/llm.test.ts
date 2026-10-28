import {
  assertAdvisorRequestRules,
  buildRuntimeBody,
  RuntimeLLM,
  TokenLedger,
  costOf,
  AdvisorBudgetError,
  type AdvisorRequest,
  type AdvisorResponse,
} from '@eco/shared/src/advisor/llm';

const baseReq: AdvisorRequest = {
  model: 'us.anthropic.claude-sonnet-5-5',
  effort: 'medium',
  maxTokens: 800,
  system: [{ type: 'text', text: 'sistema' }],
  messages: [{ role: 'user', content: 'hola' }],
  tools: [{ name: 't', description: 'd', input_schema: { type: 'object', properties: {}, additionalProperties: false }, strict: true }],
};

/** Cliente falso de bedrock-runtime: devuelve el JSON dado y guarda el cuerpo enviado. */
function fakeClientJson(payload: unknown) {
  const sent: Array<{ modelId: string; body: Record<string, unknown> }> = [];
  return {
    sent,
    client: {
      send: async (cmd: { input: { modelId: string; body: string } }) => {
        sent.push({ modelId: cmd.input.modelId, body: JSON.parse(cmd.input.body) });
        return { body: Buffer.from(JSON.stringify(payload), 'utf8') };
      },
    },
  };
}

/** Cliente falso de streaming: emite eventos de Messages en el formato que devuelve bedrock-runtime. */
function fakeClientStream(events: unknown[]) {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    client: {
      send: async (cmd: { input: { body: string } }) => {
        sent.push(JSON.parse(cmd.input.body));
        async function* body() {
          for (const ev of events) {
            yield { chunk: { bytes: Buffer.from(JSON.stringify(ev), 'utf8') } };
          }
        }
        return { body: body() };
      },
    },
  };
}

describe('reglas de request (spec §5.2)', () => {
  test('rechaza temperature, top_p y top_k', () => {
    for (const k of ['temperature', 'top_p', 'top_k']) {
      expect(() => assertAdvisorRequestRules({ [k]: 0.2 })).toThrow(/prohibido/);
    }
  });

  test('rechaza tool_choice forzado (any o tool) y acepta auto', () => {
    expect(() => assertAdvisorRequestRules({ tool_choice: { type: 'any' } })).toThrow(/forzado/);
    expect(() => assertAdvisorRequestRules({ tool_choice: { type: 'tool', name: 'x' } })).toThrow(/forzado/);
    expect(() => assertAdvisorRequestRules({ tool_choice: { type: 'auto' } })).not.toThrow();
  });

  test('el cuerpo armado nunca lleva sampling ni tool_choice', () => {
    const body = buildRuntimeBody(baseReq);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('tool_choice');
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
  });

  test('create envía el cuerpo con reglas y devuelve uso en cuatro partes', async () => {
    const fake = fakeClientJson({
      model: 'claude-sonnet-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 3, cache_creation_input_tokens: 5, cache_read_input_tokens: 7, cache_creation: { ephemeral_1h_input_tokens: 5 } },
    });
    const llm = new RuntimeLLM(fake.client);
    const res = await llm.create(baseReq);
    expect(fake.sent[0].modelId).toBe('us.anthropic.claude-sonnet-5-5');
    expect(fake.sent[0].body).not.toHaveProperty('temperature');
    expect(res.usage).toEqual({ inputNew: 10, cacheWrite5m: 0, cacheWrite1h: 5, cacheRead: 7, output: 3 });
    expect(res.stopReason).toBe('end_turn');
  });
});

describe('stream: mapeo de eventos', () => {
  test('texto, tool_use con JSON parcial y thinking se conservan', async () => {
    const events = [
      { type: 'message_start', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 4, cache_read_input_tokens: 26000 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'pienso' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hola ' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'M-48213' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu_1', name: 'situacion_actual' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"response_format":' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"resumen"}' } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } },
      { type: 'message_stop' },
    ];
    const fake = fakeClientStream(events);
    const deltas: string[] = [];
    const res = await new RuntimeLLM(fake.client).stream(baseReq, { onTextDelta: (t) => deltas.push(t) });

    expect(deltas.join('')).toBe('Hola M-48213');
    expect(res.stopReason).toBe('tool_use');
    expect(res.content).toEqual([
      { type: 'thinking', thinking: 'pienso', signature: 'SIG' },
      { type: 'text', text: 'Hola M-48213' },
      { type: 'tool_use', id: 'tu_1', name: 'situacion_actual', input: { response_format: 'resumen' } },
    ]);
    expect(res.usage.cacheRead).toBe(26000);
    expect(res.usage.output).toBe(42);
  });
});

describe('TokenLedger (spec §5.2 regla 7)', () => {
  const resp = (u: Partial<AdvisorResponse['usage']>): AdvisorResponse => ({
    model: 'us.anthropic.claude-sonnet-5-5',
    stopReason: 'end_turn',
    content: [],
    usage: { inputNew: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, ...u },
    ms: 1,
  });

  test('suma las cuatro partes y calcula costo cuando hay precio', () => {
    const l = new TokenLedger(1);
    l.add('us.anthropic.claude-sonnet-5-5', resp({ inputNew: 1_000_000, output: 100_000 }));
    const snap = l.snapshot();
    expect(snap.usage.inputNew).toBe(1_000_000);
    expect(snap.costUsd).toBeCloseTo(2 + 1, 6); // 1M in × $2 + 100k out × $10/M
  });

  test('aborta con error_budget a más de 3 veces el costo esperado', () => {
    const l = new TokenLedger(0.01);
    expect(() => l.add('us.anthropic.claude-sonnet-5-5', resp({ output: 1_000_000 }))).toThrow(AdvisorBudgetError);
  });

  test('sin precio verificado (Opus) el costo queda nulo, no estimado', () => {
    expect(costOf('us.anthropic.claude-opus-5-5', { inputNew: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 1 })).toBeNull();
    const l = new TokenLedger(0);
    l.add('us.anthropic.claude-opus-5-5', resp({ output: 10 }));
    expect(l.snapshot().costUsd).toBeNull();
  });
});
