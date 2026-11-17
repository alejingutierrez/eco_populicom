/**
 * Cliente pg de SOLO LECTURA sobre el lambda eco-migration (custom-query), para
 * scripts que corren fuera de la VPC. Tiene la forma de `PgClientLike`
 * (`query(sql, params)`), así que sirve a las mismas funciones de carga que
 * usan los lambdas y la web.
 *
 * custom-query no acepta parámetros: se incrustan como literales. Solo se
 * admiten textos, números, booleanos, null, fechas y listas de esos; los
 * valores salen del script que lo usa, nunca de un usuario.
 */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (Array.isArray(v)) return `ARRAY[${v.map(lit).join(',')}]`;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  throw new Error(`Parámetro no admitido: ${typeof v}`);
};

/** `$N` → literal. De mayor a menor para que `$1` no pise a `$10`. */
export function inlineParams(sql: string, params: unknown[] = []): string {
  let out = sql;
  for (let i = params.length; i >= 1; i--) out = out.split(`$${i}`).join(lit(params[i - 1]));
  return out;
}

export interface ReadOnlyClient {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Consultas hechas (para saber cuánto cuesta una carga). */
  count(): number;
}

export function createEcoMigrationClient(lambda = new LambdaClient({})): ReadOnlyClient {
  let n = 0;
  return {
    count: () => n,
    async query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
      n += 1;
      // custom-query exige que el texto empiece por SELECT: los CTE van envueltos.
      const query = `SELECT * FROM (${inlineParams(sql, params).trim().replace(/;\s*$/, '')}) z`;
      const res = await lambda.send(new InvokeCommand({
        FunctionName: 'eco-migration',
        Payload: Buffer.from(JSON.stringify({ action: 'custom-query', query })),
      }));
      const payload = JSON.parse(Buffer.from(res.Payload!).toString('utf8'));
      if (payload.errorMessage) throw new Error(`custom-query: ${payload.errorMessage}`);
      const body = typeof payload.body === 'string' ? JSON.parse(payload.body) : payload.body;
      if (!body || body.error) throw new Error(`custom-query: ${body?.error ?? 'sin body'}`);
      return { rows: body.rows ?? [] };
    },
  };
}
