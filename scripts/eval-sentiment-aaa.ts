/**
 * Evaluación offline del clasificador de SENTIMIENTO para AAA — caso
 * "0 positivos desde junio" (auditoría de datos 2026-08).
 *
 * Compara dos variantes de las REGLAS DE SENTIMIENTO del processor sobre un
 * golden set etiquetado a mano (scripts/eval/aaa-sentiment-golden.json):
 *
 *   ACTUAL    — las reglas vigentes (commit 32f6aa3, 19-abr-2026): positivo
 *               EXCLUSIVAMENTE con elogio explícito; "NO marques positivo
 *               solo porque se resuelva un problema"; hint de Brandwatch con
 *               prioridad. Arreglaron la inflación de DDEC (65%→3%) pero
 *               dejaron a AAA en 0.0% absoluto.
 *   PROPUESTA — las mismas reglas + una tercera vía a positivo: LOGRO
 *               OPERATIVO CONSUMADO o MEDIDA DE ALIVIO CONCRETA (reparación
 *               culminada, servicio restablecido, acuerdo que evita un paro,
 *               suspensión de cortes), manteniendo neutral para anuncios
 *               futuros/propuestas/compromisos (la guarda anti-DDEC).
 *
 * Aisla el sentimiento (una sola herramienta classify_sentiment) para no
 * gastar tokens en topics/municipios; usa el MISMO modelo primario de prod.
 *
 * Uso:
 *   set -a && source .env && set +a
 *   node_modules/.bin/tsx scripts/eval-sentiment-aaa.ts [--model <bedrock-id>] [--variant ACTUAL|PROPUESTA|ambas]
 *
 * Reporta por variante: exactitud global, recall/precisión de positivos,
 * violaciones de la guarda DDEC (anuncios re-inflados a positivo) y la lista
 * de desacuerdos. NO toca producción.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const MODEL = process.argv.includes('--model')
  ? process.argv[process.argv.indexOf('--model') + 1]
  : 'us.anthropic.claude-opus-4-6-v1';
const VARIANT_ARG = process.argv.includes('--variant')
  ? process.argv[process.argv.indexOf('--variant') + 1]
  : 'ambas';

const client = new BedrockRuntimeClient({});

interface GoldenItem {
  id: string; estrato: string; agency: string; agencyName: string;
  fecha: string; domain: string; titulo: string; snippet: string;
  bw_sentiment: string | null; nlp_prod: string | null; label: string; motivo: string;
}

const golden: { rubrica: string; items: GoldenItem[] } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'eval/aaa-sentiment-golden.json'), 'utf8'),
);

/** Reglas VIGENTES — copia verbatim del prompt del processor (infra/lambda/processor/index.ts). */
function reglasActual(agencyName: string): string {
  return `REGLAS DE SENTIMIENTO (muy importantes — los datos actuales tienen sesgo positivo):
- "positivo" EXCLUSIVAMENTE cuando el autor/medio expresa evaluación explícitamente favorable hacia ${agencyName}: elogios, logros celebrados por la ciudadanía, resolución de problemas agradecida, decisiones aplaudidas. Señales: "felicita", "excelente", "gracias a", "aplauden", "reconocimiento".
- "negativo" cuando la mención expresa queja, crítica, denuncia, fallo operativo, escándalo, protesta, reclamo ciudadano, o el autor/medio usa lenguaje desfavorable. Señales: "denuncia", "protesta", "falla", "critica", "cuestiona", "sigue sin", "años sin", "exigen".
- "neutral" por defecto para: reportajes informativos sin valoración, comunicados oficiales, anuncios institucionales sin reacción pública visible, datos, números de contacto, inauguraciones descritas sin entusiasmo evaluativo. Si el texto solo DESCRIBE sin evaluar, es neutral.
- NO marques positivo solo porque se resuelva un problema o se inaugure algo. Solo cuando haya elogio explícito.
- Si el Sentimiento Brandwatch dice "neutral", usa "neutral" salvo que el texto tenga señales inequívocas de positivo/negativo.`;
}

/** Reglas PROPUESTAS — las actuales + la vía del logro consumado con guardas. */
function reglasPropuesta(agencyName: string): string {
  return `${reglasActual(agencyName)}
- "positivo" TAMBIÉN cuando la mención reporta un LOGRO OPERATIVO CONSUMADO o una MEDIDA DE ALIVIO CONCRETA de ${agencyName} hacia la ciudadanía, aunque no haya elogio explícito: reparación CULMINADA, servicio RESTABLECIDO ("culmina", "completa", "restablece" + el trabajo terminado), acuerdo que resuelve un conflicto (p. ej. deja sin efecto un paro), alivio directo al abonado (suspensión de cortes, prórrogas de pago, créditos otorgados). En cobertura de agencias de servicio público, el hecho favorable CONSUMADO es en sí la evaluación.
- SIGUE siendo "neutral": anuncios de trabajos FUTUROS, propuestas, planes, compromisos sin ejecutar, avances PARCIALES con clientes aún afectados, inauguraciones protocolares y anuncios de inversión o expansión sin resultado material entregado. La regla "no marques positivo por anuncios" SE MANTIENE: el logro debe estar consumado y beneficiar ya al ciudadano.
- Prioridad del hint: si el texto reporta un logro consumado o un alivio concreto, márcalo "positivo" aunque el Sentimiento Brandwatch diga "neutral".`;
}

const TOOL = {
  name: 'classify_sentiment',
  description: 'Registra el sentimiento de la mención hacia la agencia.',
  input_schema: {
    type: 'object',
    properties: {
      sentiment: { type: 'string', enum: ['positivo', 'neutral', 'negativo'] },
      razon: { type: 'string', description: 'Una frase con el porqué.' },
    },
    required: ['sentiment'],
  },
} as const;

function buildPrompt(item: GoldenItem, reglas: string): string {
  const bwHint = item.bw_sentiment
    ? `\nSentimiento Brandwatch (referencia): ${item.bw_sentiment}`
    : '';
  return `Eres un analista de social listening especializado en Puerto Rico.
Analiza esta mención sobre ${item.agencyName}.

MENCIÓN:
Título: ${item.titulo ?? '(sin título)'}
Texto: ${item.snippet ?? '(sin texto)'}
Fuente: ${item.domain}
Fecha: 2026-${item.fecha}${bwHint}

Llama a la herramienta classify_sentiment con el sentimiento correcto.

${reglas}`;
}

async function classify(item: GoldenItem, reglas: string, attempt = 0): Promise<string> {
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 200,
    messages: [{ role: 'user', content: buildPrompt(item, reglas) }],
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'classify_sentiment' },
  };
  try {
    const res = await client.send(new InvokeModelCommand({
      modelId: MODEL,
      body: Buffer.from(JSON.stringify(body)),
      contentType: 'application/json',
    }));
    const out = JSON.parse(Buffer.from(res.body).toString('utf8'));
    const toolUse = (out.content ?? []).find((c: { type: string }) => c.type === 'tool_use');
    return toolUse?.input?.sentiment ?? 'ERROR';
  } catch (err) {
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return classify(item, reglas, attempt + 1);
    }
    console.error('  error persistente en', item.id, (err as Error).name);
    return 'ERROR';
  }
}

async function runVariant(name: string, reglasFor: (agencyName: string) => string): Promise<void> {
  console.log(`\n════ Variante ${name} · modelo ${MODEL} · n=${golden.items.length} ════`);
  const results: Array<{ item: GoldenItem; pred: string }> = [];
  const queue = [...golden.items];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      const pred = await classify(item, reglasFor(item.agencyName));
      results.push({ item, pred });
      process.stdout.write('.');
    }
  });
  await Promise.all(workers);
  console.log('');

  const ok = results.filter((r) => r.pred === r.item.label).length;
  const posGold = results.filter((r) => r.item.label === 'positivo');
  const posPred = results.filter((r) => r.pred === 'positivo');
  const posHit = posGold.filter((r) => r.pred === 'positivo').length;
  const ddecViol = results.filter((r) => r.item.estrato === 'ddec_regresion' && r.pred === 'positivo');

  console.log(`exactitud global: ${ok}/${results.length} (${Math.round((ok / results.length) * 100)}%)`);
  console.log(`recall de positivos: ${posHit}/${posGold.length}`);
  console.log(`precisión de positivos: ${posHit}/${posPred.length || 0}${posPred.length ? ` (${Math.round((posHit / posPred.length) * 100)}%)` : ' (no predijo ninguno)'}`);
  console.log(`guarda DDEC (anuncios→positivo, debe ser 0): ${ddecViol.length}`);
  const misses = results.filter((r) => r.pred !== r.item.label);
  if (misses.length) {
    console.log('desacuerdos:');
    for (const m of misses) {
      console.log(`  [${m.item.estrato}] esperado=${m.item.label} pred=${m.pred} · ${(m.item.titulo || '').slice(0, 80)}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`golden: ${golden.items.length} items · rúbrica: ${golden.rubrica}`);
  if (VARIANT_ARG === 'ACTUAL' || VARIANT_ARG === 'ambas') await runVariant('ACTUAL', reglasActual);
  if (VARIANT_ARG === 'PROPUESTA' || VARIANT_ARG === 'ambas') await runVariant('PROPUESTA', reglasPropuesta);
}

main().catch((e) => { console.error(e); process.exit(1); });
