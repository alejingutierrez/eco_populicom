#!/usr/bin/env python3
"""Evalúa las corridas de classify-lab.py contra los jueces y produce la tabla del spec 6.4 y las compuertas 13.2.

Uso:
  python3 scripts/qa/eval-classification.py --runs out/runs [--gates-out out/gates.classify.json] [--md-out out/tabla-6.4.md]
  python3 scripts/qa/eval-classification.py --cached        # evalúa las corridas de referencia del 2-nov (cero costo, cero llamadas)

Busca en --runs los archivos ddec208.json, ddec867.json, df397.json, df162.json (salida de classify-lab.py) y, para
estabilidad, el segundo juego `<nombre>.b.json` (otra corrida con la misma configuración). Evalúa solo lo que exista y
solo sobre los ids que la corrida cubre (submuestras con --limit se marcan con su n).

Definiciones (idénticas a las del laboratorio, para que las cifras sean comparables con el spec 6.4):
  acuerdo           = % de menciones donde la etiqueta del sistema coincide con la del juez (postura hacia la agencia)
  precisión neg.    = de lo que el sistema marca negativo, % que el juez también ve negativo
  NSS               = (positivos − negativos) / total × 100, sobre el universo indicado
  DDEC «por tono»   = sentimiento del sistema vs `tone` del juez Opus (un «mixto» del juez cuenta como desacuerdo)
  hecho adverso     = acuerdo booleano de adverse_fact vs hecho_malo_para_df del juez (DF)
  estabilidad       = % de ids con la MISMA etiqueta en dos corridas (sentimiento y pertinencia, por separado)
"""
import argparse
import collections as C
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import qa_common as qc  # noqa: E402
import qa_gates as qg  # noqa: E402

SM = {'favorable': 'positivo', 'unfavorable': 'negativo', 'neutral_none': 'neutral'}


def load_run(path):
    if not os.path.exists(path):
        return None, None
    rows = [d for d in qc.load_json(path) if 'error' not in d]
    meta = qc.load_json(path + '.meta.json') if os.path.exists(path + '.meta.json') else {}
    return qc.by_id(rows), meta


def model_label(meta):
    m = (meta or {}).get('model', '')
    return 'Opus' if 'opus' in m else 'Sonnet' if 'sonnet' in m else (m or '?')


# ---------------------------------------------------------------- DF
def eval_df(name, run, meta):
    rows = qc.by_id(qc.load_json(qc.fx('df', 'census404.json')))
    judge = qc.by_id(qc.load_json(qc.fx('df', 'judge397.json' if name == 'df397' else 'judge162.json')))
    ids = [i for i in run if i in judge]
    n = len(ids)
    if not n:
        return None
    jn = {i: judge[i]['sentimiento_hacia_df'] for i in ids}
    v2 = {i: run[i]['sentiment'] for i in ids}
    pr = {i: rows[i]['nlp_sentiment'] for i in ids}
    r = {'n': n, 'full': len(judge), 'model': model_label(meta)}
    r['agree_v2'] = qc.pctv(sum(v2[i] == jn[i] for i in ids), n)
    r['agree_prod'] = qc.pctv(sum(pr[i] == jn[i] for i in ids), n)
    nv = [i for i in ids if v2[i] == 'negativo']
    npd = [i for i in ids if pr[i] == 'negativo']
    r['prec_v2'] = qc.pctv(sum(jn[i] == 'negativo' for i in nv), len(nv))
    r['prec_prod'] = qc.pctv(sum(jn[i] == 'negativo' for i in npd), len(npd))
    r['prec_v2_frac'] = (sum(jn[i] == 'negativo' for i in nv), len(nv))
    r['nss_v2'] = qc.nss(C.Counter(v2.values()))
    r['nss_prod'] = qc.nss(C.Counter(pr.values()))
    r['nss_judge'] = qc.nss(C.Counter(jn.values()))
    r['adverse'] = qc.pctv(sum(bool(run[i].get('adverse_fact')) == bool(judge[i]['hecho_malo_para_df']) for i in ids), n)
    r['pert_agree'] = qc.pctv(sum(run[i]['pertinence'] == judge[i]['pertinencia'] for i in ids), n)
    return r


# ---------------------------------------------------------------- DDEC
def eval_ddec208(run, meta):
    rows = qc.by_id(qc.load_json(qc.fx('ddec', 'sample208.json')))
    judge = qc.by_id(qc.load_json(qc.fx('ddec', 'judge208.json')))
    ids = [i for i in run if i in judge]
    n = len(ids)
    if not n:
        return None
    r = {'n': n, 'full': len(judge), 'model': model_label(meta)}
    r['tone_v2'] = qc.pctv(sum(run[i]['sentiment'] == judge[i]['tone'] for i in ids), n)
    r['tone_prod'] = qc.pctv(sum(rows[i]['nlp_sentiment'] == judge[i]['tone'] for i in ids), n)
    r['stance_v2'] = qc.pctv(sum(run[i]['sentiment'] == SM[judge[i]['stance_ddec']] for i in ids), n)
    pos = [i for i in ids if run[i]['sentiment'] == 'positivo']
    r['pos_not_pos'] = (sum(judge[i]['tone'] != 'positivo' for i in pos), len(pos))
    own = [i for i in ids if rows[i]['cat'] == 'own_post']
    r['own_prod'] = (sum(rows[i]['nlp_sentiment'] == 'positivo' for i in own), len(own))
    r['own_v2'] = (sum(run[i]['sentiment'] == 'positivo' for i in own), len(own))
    r['baja_v2'] = sum(run[i]['pertinence'] == 'baja' for i in ids)
    r['baja_prod'] = sum(rows[i]['nlp_pertinence'] == 'baja' for i in ids)
    return r


def eval_ddec867(run, meta):
    rows = qc.load_json(qc.fx('ddec', 'pop867.json'))
    rows = [d for d in rows if d['id'] in run]
    if not rows:
        return None
    pc = C.Counter(d['nlp_sentiment'] for d in rows if d['nlp_pertinence'] != 'baja')
    vc = C.Counter(run[d['id']]['sentiment'] for d in rows if run[d['id']]['pertinence'] != 'baja')
    return {'n': len(rows), 'model': model_label(meta), 'nss_prod': qc.nss(pc), 'nss_v2': qc.nss(vc),
            'universe_prod': sum(pc.values()), 'universe_v2': sum(vc.values()),
            'baja_prod': sum(d['nlp_pertinence'] == 'baja' for d in rows), 'baja_v2': sum(run[d['id']]['pertinence'] == 'baja' for d in rows)}


def stability(a, b):
    ids = [i for i in a if i in b]
    if not ids:
        return None
    return {'n': len(ids), 'sent': qc.pctv(sum(a[i]['sentiment'] == b[i]['sentiment'] for i in ids), len(ids)),
            'pert': qc.pctv(sum(a[i]['pertinence'] == b[i]['pertinence'] for i in ids), len(ids))}


# ---------------------------------------------------------------- tabla
def f0(v):
    return '—' if v is None else f'{v:.0f} %'


def frac(t):
    return f'{t[0]} de {t[1]}'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--runs', help='directorio con las corridas de classify-lab.py')
    ap.add_argument('--cached', action='store_true', help='usa las corridas de referencia de fixtures/refs (sin costo)')
    ap.add_argument('--gates-out')
    ap.add_argument('--md-out')
    a = ap.parse_args()
    if a.cached:
        d = str(qc.fx('refs'))
    elif a.runs:
        d = a.runs
    else:
        ap.error('indica --runs DIR o --cached')

    res = {}
    for name in ('ddec208', 'ddec867', 'df397', 'df162'):
        run, meta = load_run(os.path.join(d, f'{name}.json'))
        if run is None:
            continue
        if name.startswith('df'):
            res[name] = eval_df(name, run, meta)
        elif name == 'ddec208':
            res[name] = eval_ddec208(run, meta)
        else:
            res[name] = eval_ddec867(run, meta)
        runb, _ = load_run(os.path.join(d, f'{name}.b.json'))
        if runb is not None:
            res[name + ':stab'] = stability(run, runb)
    res = {k: v for k, v in res.items() if v}
    if not res:
        print('[eval-classification] no hay corridas en', d)
        return 2

    rows, gates = [], []
    ref = {
        'df_agree': '53 % → 79 % (Sonnet), 75 a 77 % (Opus)', 'df_prec': '34 % → 94 a 100 %', 'df_nss': '−55.7 → −8.6 (el juez da −12)',
        'df_adv': '89 a 92 %', 'dd_tone': '75 % → 75 %', 'dd_pos': '1 de 67', 'dd_own': '3 de 23 → 0 de 23',
        'dd_nss': '+11.4 → +21.6', 'dd_baja': '156 → 77', 'stab': '100 %, 100 %',
    }
    for name in ('df397', 'df162'):
        r = res.get(name)
        if not r:
            continue
        tag = f'DF {r["model"]} n={r["n"]}'
        rows.append([f'DF, acuerdo de sentimiento con el juez ({tag})', f0(r['agree_prod']), f0(r['agree_v2']), ref['df_agree']])
        rows.append([f'DF, precisión de lo marcado negativo ({tag})', f0(r['prec_prod']), f'{f0(r["prec_v2"])} ({frac(r["prec_v2_frac"])})', ref['df_prec']])
        rows.append([f'DF, NSS ({tag})', qc.fmt_nss(r['nss_prod']), f'{qc.fmt_nss(r["nss_v2"])} (juez {qc.fmt_nss(r["nss_judge"])})', ref['df_nss']])
        rows.append([f'DF, acuerdo de hecho adverso con el juez ({tag})', 'n/a', f0(r['adverse']), ref['df_adv']])
    r = res.get('ddec208')
    if r:
        tag = f'n={r["n"]}'
        rows.append([f'DDEC, acuerdo por tono con el juez ({tag})', f0(r['tone_prod']), f0(r['tone_v2']), ref['dd_tone']])
        rows.append(['DDEC, positivos que el juez no ve positivos', 'n/a', frac(r['pos_not_pos']), ref['dd_pos']])
        rows.append(['DDEC, publicaciones propias marcadas positivas', frac(r['own_prod']), frac(r['own_v2']), ref['dd_own']])
    r = res.get('ddec867')
    if r:
        tag = f'{r["n"]}, {r["model"]}'
        rows.append([f'DDEC semana completa ({tag}), NSS pertinente', qc.fmt_nss(r['nss_prod']), qc.fmt_nss(r['nss_v2']), ref['dd_nss']])
        rows.append(['DDEC semana completa, menciones de pertinencia baja', str(r['baja_prod']), str(r['baja_v2']), ref['dd_baja']])
    stabs = [(k.split(':')[0], v) for k, v in res.items() if k.endswith(':stab')]
    for k, v in stabs:
        rows.append([f'Estabilidad entre dos corridas ({k}, n={v["n"]}): sentimiento, pertinencia', 'n/a', f'{f0(v["sent"])}, {f0(v["pert"])}', ref['stab']])

    title = '## Tabla 6.4 — resultados del laboratorio (producción vs rúbrica v2)'
    out = [title, qc.table(['Medida', 'Producción', 'Rúbrica v2 (esta corrida)', 'Referencia del spec'], rows)]
    extra = []
    for name in ('df397', 'df162'):
        if name in res:
            r = res[name]
            extra.append(f'  - {name}: acuerdo de pertinencia con el juez {f0(r["pert_agree"])}')
    if 'ddec208' in res:
        extra.append(f'  - ddec208: acuerdo con la postura hacia el DDEC (stance) {f0(res["ddec208"]["stance_v2"])}; '
                     f'pertinencia baja v2 {res["ddec208"]["baja_v2"]} vs producción {res["ddec208"]["baja_prod"]}')
    if 'ddec867' in res:
        r = res['ddec867']
        extra.append(f'  - ddec867: universo pertinente producción {r["universe_prod"]} vs v2 {r["universe_v2"]} de {r["n"]}')
    if extra:
        out.append('Datos adicionales:\n' + '\n'.join(extra))
    text = '\n'.join(out)
    print(text)
    if a.md_out:
        os.makedirs(os.path.dirname(os.path.abspath(a.md_out)), exist_ok=True)
        open(a.md_out, 'w', encoding='utf-8').write(text + '\n')

    # ------------------------------------------------ compuertas 13.2
    df = res.get('df397') or res.get('df162')
    if df:
        pt = df['n'] < df['full']
        gates.append(qg.ge('df_agreement', df['agree_v2'], df['n'], f'DF {df["model"]}', partial=pt))
        gates.append(qg.ge('df_neg_precision', df['prec_v2'], df['n'], f'{df["prec_v2_frac"][0]} de {df["prec_v2_frac"][1]} marcados negativos', partial=pt))
        gates.append(qg.ge('adverse_fact', df['adverse'], df['n'], partial=pt))
    if 'ddec208' in res:
        gates.append(qg.ge('ddec_tone', res['ddec208']['tone_v2'], res['ddec208']['n'], partial=res['ddec208']['n'] < res['ddec208']['full']))
    if stabs:
        # la compuerta toma el PEOR valor de sentimiento y pertinencia entre todas las parejas de corridas
        worst = min(min(v['sent'], v['pert']) for _, v in stabs)
        nn = sum(v['n'] for _, v in stabs)
        part = any(k == 'ddec208' and v['n'] < res['ddec208']['full'] for k, v in stabs if 'ddec208' in res)
        gates.append(qg.ge('stability', worst, nn, 'peor de sentimiento/pertinencia: ' + '; '.join(f'{k} {f0(v["sent"])}/{f0(v["pert"])}' for k, v in stabs), partial=part))
    if a.gates_out:
        qg.save_gates(gates, a.gates_out)
    print()
    print(qg.render(gates, '### Compuertas evaluadas en este paso'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
