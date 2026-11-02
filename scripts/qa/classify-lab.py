#!/usr/bin/env python3
"""Laboratorio de clasificación (rúbrica v2): clasifica un conjunto de oro con Bedrock y guarda las etiquetas.

Solo llama a Bedrock; NO toca la base de datos ni el repo. Es reanudable: si --out ya existe, salta los ids hechos.

Uso:
  python3 scripts/qa/classify-lab.py --set ddec208 --out out/runs/ddec208.json [--model sonnet|opus|<id>]
        [--limit 20] [--seed 20261102] [--workers 5] [--max-calls 400] [--ids ids.json] [--temperature 0.1] [--dry-run]

Conjuntos (fixtures/):  ddec208 (muestra estratificada, juez Opus) · ddec867 (semana completa 25-oct a 1-nov)
                        df397 (censo DF, juez Sonnet) · df162 (submuestra de df397 con juez Opus)

Salida: lista JSON [{id, sentiment, adverse_fact, pertinence, summary, topics, emotions, municipalities}] más
`<out>.meta.json` con {set, model, seed, limit, n, temperature} (lo lee eval-classification.py).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import qa_common as qc  # noqa: E402
import lab_prompts as lp  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--set', required=True, choices=['ddec208', 'ddec867', 'df397', 'df162'])
    ap.add_argument('--out', required=True)
    ap.add_argument('--model', default='sonnet')
    ap.add_argument('--limit', type=int, default=None, help='submuestra reproducible de N ids (por defecto, todo el conjunto)')
    ap.add_argument('--seed', type=int, default=qc.DEFAULT_SEED)
    ap.add_argument('--ids', help='JSON con la lista de ids a clasificar (sustituye a --limit/--seed)')
    ap.add_argument('--workers', type=int, default=5)
    ap.add_argument('--temperature', type=float, default=0.1)
    ap.add_argument('--max-calls', type=int, default=None, help='tope duro de llamadas a Bedrock (también ECO_QA_MAX_CALLS)')
    ap.add_argument('--dry-run', action='store_true', help='lista lo que haría, sin llamar a Bedrock')
    a = ap.parse_args()
    if a.max_calls:
        qc.USAGE.max_calls = a.max_calls

    rows, _judge, prompt_fn = lp.get_set(a.set)
    all_ids = [r['id'] for r in rows]
    if a.ids:
        want = set(qc.load_json(a.ids))
        ids = [i for i in all_ids if i in want]
    else:
        ids = qc.sample_ids(all_ids, a.limit, a.seed)
    rowmap = qc.by_id(rows)
    mid = qc.model_id(a.model)

    done = {}
    if os.path.exists(a.out):
        done = {d['id']: d for d in qc.load_json(a.out) if 'error' not in d}
    todo = [i for i in ids if i not in done]
    print(f'[classify-lab] set={a.set} modelo={mid} n={len(ids)} (ya hechos: {len(ids) - len(todo)}, por hacer: {len(todo)}) semilla={a.seed}')

    if a.dry_run:
        if todo:
            p = prompt_fn(rowmap[todo[0]])
            print(f'  prompt de ejemplo ({len(p):,} caracteres ≈ {len(p) // 4:,} tokens de entrada), primeros 500:')
            print('  | ' + p[:500].replace('\n', '\n  | '))
            est = sum(len(prompt_fn(rowmap[i])) for i in todo[:50]) / min(50, len(todo)) * len(todo) / 4
            print(f'  llamadas previstas: {len(todo)} · entrada estimada ≈ {est / 1e6:.2f} M tokens · salida ≈ {len(todo) * 250 / 1e6:.2f} M tokens')
        print('  (--dry-run: no se llamó a Bedrock)')
        return 0

    qc.load_env()

    def one(i):
        try:
            d = qc.bedrock_tool(a.model, prompt_fn(rowmap[i]), lp.CLASSIFY_TOOL, max_tokens=1024, temperature=a.temperature)
        except qc.BudgetExceeded as e:  # no se reintenta: queda como error y la corrida se reanuda con otro presupuesto
            return {'id': i, 'error': 'presupuesto: ' + str(e)}
        except Exception as e:  # un error aislado no tumba la corrida; se reintenta al reanudar
            return {'id': i, 'error': str(e)[:200]}
        d['id'] = i
        return d

    res = qc.run_pool(one, todo, a.workers, label='clasificadas')
    for d in res:
        if d is not None:
            done[d['id']] = d
    if any(str(d.get('error', '')).startswith('presupuesto') for d in done.values()):
        print('[classify-lab] ABORTADO por el tope de llamadas: las no hechas quedan como error; reanuda con otro --max-calls', file=sys.stderr)
    ok = [d for d in done.values() if 'error' not in d]
    qc.save_json(list(done.values()), a.out, indent=None)
    qc.save_json({'set': a.set, 'model': mid, 'seed': a.seed, 'limit': a.limit, 'n': len(ok), 'temperature': a.temperature}, a.out + '.meta.json')
    errs = sum('error' in d for d in done.values())
    print(f'[classify-lab] listo: {len(ok)} clasificadas, {errs} con error → {a.out}')
    print('[classify-lab]', qc.USAGE.summary())
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main())
