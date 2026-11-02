#!/usr/bin/env python3
"""Juez independiente de los TEXTOS del correo diario (titular, párrafo, viñetas, insights) sobre las 6 ventanas.

Para cada ventana de fixtures/windows/ (DDEC 22-oct, 31-oct, 1-nov; DF 26-oct, 30-oct, 1-nov) un juez ciego
descompone el texto en afirmaciones atómicas y las verifica contra los datos reales de esa ventana (conteos, serie
diaria, muestras con la fecha de su publicación original). Además mide dramatismo del titular, «post viejo
presentado como noticia del día» y contradicciones, y corre un lint de CÓDIGO (verbos dramáticos, cifras sin fuente).

Uso:
  python3 scripts/qa/compose-judge.py [--candidates team,base] [--windows ddecpr_20261101,df_20261030 | --limit-windows 2]
        [--model sonnet|opus] [--gate-on team] [--out DIR] [--cached] [--dry-run] [--workers 3]
  python3 scripts/qa/compose-judge.py --ledger [--model sonnet]      # calibra al juez contra el libro de 127 afirmaciones

Candidatos (--candidates, separados por coma):
  team   texto del prototipo de equipo de agentes del 2-nov (fixtures/windows/<w>/text.team.json)  ← compuertas
  base   texto del modelo único en producción (text.base.json)                                       ← línea base, sin compuerta
  dir:RUTA  carpeta con <ventana>.json = {headline, paragraph, highlights[], insights{negative,neutral,positive}}
            (aquí se conecta el motor nuevo de WP-3..6 para el harness de regresión)
--cached usa los veredictos del juez ya guardados en fixtures/refs/windows (sin llamar a Bedrock).

Salida: tabla por ventana y texto + compuertas 13.2 (afirmaciones con defecto, graves/falsas/mal fechadas, post viejo,
dramatismo, lint) para el candidato de --gate-on.
"""
import argparse
import datetime as dt
import json
import os
import re
import statistics
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import qa_common as qc  # noqa: E402
import qa_gates as qg  # noqa: E402

DOW = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
MON = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
GRAVES = ('falsa', 'sin_respaldo', 'mal_fechada')   # «defectos graves» del spec 13.2

# Verbos de fuerza y figuras que el estilo del equipo prohíbe (lint de código; ver spec sección 9)
VETO = ['aprieta', 'aprietan', 'apretó', 'acorrala', 'acorralan', 'se deslinda', 'se deslindan', 'traslada la carga', 'se apaga', 'se apagó',
        'sobrevive', 'sobreviven', 'flanco', 'dispara', 'disparan', 'arremete', 'arremetió', 'copó', 'copa ', 'tira y jala', 'bajo fuego',
        'bajo la lupa', 'contra el reloj', 'arrastra', 'se agudiza', 'estalla', 'sacude', 'sacudió', 'zozobra', 'otro frente', 'nuevo frente',
        'segundo frente']

STR = {'type': 'string'}
JUDGE = {'type': 'object', 'properties': {
    'claims': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'section': STR, 'claim': STR,
        'verdict': {'type': 'string', 'enum': ['verdadera', 'verdadera_pero_enganosa', 'exagerada', 'falsa', 'sin_respaldo', 'mal_fechada']},
        'why': STR}, 'required': ['section', 'claim', 'verdict', 'why']}},
    'headline_drama_0_5': {'type': 'integer'},
    'old_post_presented_as_day_news': {'type': 'boolean'},
    'contradictions_between_blocks': {'type': 'array', 'items': STR},
    'notes': STR},
    'required': ['claims', 'headline_drama_0_5', 'old_post_presented_as_day_news', 'contradictions_between_blocks']}

LEDGER_SCHEMA = {'type': 'object', 'properties': {'results': {'type': 'array', 'items': {'type': 'object', 'properties': {
    'id': STR, 'verdict': JUDGE['properties']['claims']['items']['properties']['verdict'], 'why': STR},
    'required': ['id', 'verdict', 'why']}}}, 'required': ['results']}
LEDGER_MAP = {'V': 'verdadera', 'VE': 'verdadera_pero_enganosa', 'EX': 'exagerada', 'MF': 'mal_fechada', 'SR': 'sin_respaldo', 'F': 'falsa'}

JUDGE_SYSTEM = ('Eres un verificador de hechos independiente y estricto. Juzgas un texto de un correo de monitoreo de medios y redes '
                'contra los datos reales que se te dan. No sabes quién lo escribió.')


# ---------------------------------------------------------------- contexto de la ventana
def pr_dt(iso):
    return dt.datetime.fromisoformat(iso.replace('Z', '+00:00')) - dt.timedelta(hours=4)


def day_label(s):
    d = pr_dt(s) if 'T' in s else dt.datetime.fromisoformat(s)
    return f'{DOW[d.weekday()]} {d.day} de {MON[d.month - 1]}'


def sample_line(a):
    head = f"[{a['sid']}] {a['kind']}"
    if a['author']:
        head += f" | autor/página: {a['author']}"
    head += f" | escrito el {a['day']}"
    if a['comment']:
        if a['parent_day']:
            head += f" | PUBLICACIÓN ORIGINAL de {a['parent_author'] or 'la agencia'} del {a['parent_day']} (el comentario llegó {a['age_days']} días después)"
        return f"{head} | sentimiento ECO: {a['sentiment']} | tópico: {a['topic']}\n    publicación: {a['parent_text']}\n    comentario: {a['text']}"
    return f"{head} | sentimiento ECO: {a['sentiment']} | tópico: {a['topic']}\n    texto: {a['text']}"


def window_context(w):
    """Devuelve (ctx, samples_txt, facts, samples) de una ventana de fixtures."""
    base = qc.fx('windows', w)
    d = qc.load_json(base / 'window.json')
    facts = qc.load_json(base / 'facts.json')
    samples = qc.load_json(base / 'samples.json')
    day_txt = day_label(d['dailySeries'][-1]['date'])
    facts_block = '\n'.join(f'- {k} = {v[1]}  ({v[2]})' for k, v in facts.items())
    ctx = (f"AGENCIA: {d['agency']['name']}\nPERIODO: {d['window']['startYmd']} a {d['window']['endYmd']} (días calendario cerrados en America/Puerto_Rico). "
           f"DÍA QUE SE RESUME: {day_txt}.\n\nHECHOS (datos reales):\n{facts_block}\n\n")
    today = [a for a in samples if a['sid'].startswith('D')]
    wk = {k: [a for a in samples if a['sid'].startswith(p)] for k, p in (('negativo', 'N'), ('neutral', 'E'), ('positivo', 'P'))}
    samples_txt = ('MENCIONES MÁS RECIENTES DEL DÍA RESUMIDO:\n' + '\n'.join(sample_line(a) for a in today) +
                   ''.join(f"\n\nMENCIONES {k.upper()}S DE LOS 7 DÍAS (las de más engagement):\n" + '\n'.join(sample_line(a) for a in v) for k, v in wk.items()))
    return ctx, samples_txt, facts, samples


def draft_text(dr):
    return (f"TITULAR: {dr['headline']}\n\nPÁRRAFO: {dr['paragraph']}\n\nVIÑETAS:\n" + '\n'.join(f'- {x}' for x in dr['highlights']) +
            '\n\nINSIGHTS:\n' + '\n'.join(f'[{k}] {x}' for k, v in dr['insights'].items() for x in v))


# ---------------------------------------------------------------- lint de código
def code_lint(txt, where, facts, names):
    """Residuos de código: verbos/figuras prohibidos y cifras que no salen de la lista de hechos."""
    probs = []
    txt = re.sub(r'usuario_[0-9a-f]{6}', ' ', txt)  # seudónimos de los fixtures (llevan dígitos que no son cifras)
    for nm in sorted(names, key=len, reverse=True):
        txt = txt.replace(nm, ' ')
    low = txt.lower()
    for v in VETO:
        if v in low:
            probs.append({'where': where, 'type': 'tono_dramatico', 'quote': v})
    allowed = ({str(v[0]) for v in facts.values()} | {str(abs(v[0])) for v in facts.values()} | {'7'} |
               {str(int(k[-2:])) for k in facts if k.startswith('series_')})
    clean = re.sub(r'\b\d{1,2} de (' + '|'.join(MON) + r')\b', '', txt)
    clean = re.sub(r'\b20\d\d\b', '', clean)
    for n in re.findall(r'\d[\d.,]*', clean):
        n2 = n.strip('.,')
        if n2 and n2 not in allowed and n2.replace(',', '') not in allowed:
            probs.append({'where': where, 'type': 'cifra_sin_fuente', 'quote': n2})
    return probs


def lint_draft(dr, facts, names):
    strip = lambda s: re.sub('<[^>]+>', '', s)
    p = code_lint(dr['headline'], 'titular', facts, names) + code_lint(strip(dr['paragraph']), 'párrafo', facts, names)
    for i, x in enumerate(dr['highlights']):
        p += code_lint(strip(x), f'viñeta {i + 1}', facts, names)
    for k, v in dr['insights'].items():
        for i, x in enumerate(v):
            p += code_lint(strip(x), f'insight {k} {i + 1}', facts, names)
    return p


# ---------------------------------------------------------------- juez
def judge_text(model, ctx, samples_txt, dr):
    prompt = (ctx + samples_txt + '\n\nTEXTO A VERIFICAR:\n' + draft_text(dr) + """

TAREA: extrae las afirmaciones atómicas del texto (titular, párrafo, viñetas, insights) y juzga cada una contra los datos y las muestras (con sus fechas y fechas de publicación original):
verdadera | verdadera_pero_enganosa (cierta pero deja una impresión falsa u omite algo clave, p. ej. no dice que la publicación es vieja) | exagerada (cuantificador o intensidad mayor que la evidencia) | falsa | sin_respaldo (no se puede comprobar con los datos) | mal_fechada.
Las cifras del texto se comparan con los datos reales; los números pueden venir de los datos dados. Además: headline_drama_0_5 (0 = literal y sobrio, 5 = tabloide: verbos de fuerza, intención atribuida, figuras); old_post_presented_as_day_news (true si el texto presenta como noticia o actividad del día una publicación o reacción a una publicación de más de 2 días sin decirlo); contradictions_between_blocks.""")
    return qc.bedrock_tool(model, prompt, {'name': 'submit', 'description': 'Entrega el resultado estructurado.', 'input_schema': JUDGE},
                           system=JUDGE_SYSTEM, max_tokens=6000, temperature=0.0)


def summarize(j):
    cl = j['claims']
    bad = [c for c in cl if c['verdict'] != 'verdadera']
    hard = [c for c in cl if c['verdict'] in GRAVES]
    return {'afirmaciones': len(cl), 'con_defecto': len(bad), 'graves': len(hard),
            'falsas': sum(c['verdict'] == 'falsa' for c in cl), 'mal_fechadas': sum(c['verdict'] == 'mal_fechada' for c in cl),
            'drama': j['headline_drama_0_5'], 'post_viejo': bool(j['old_post_presented_as_day_news']),
            'contradicciones': len(j['contradictions_between_blocks'])}


def candidate_text(spec, w):
    if spec in ('team', 'base'):
        return qc.load_json(qc.fx('windows', w, f'text.{spec}.json'))
    if spec.startswith('dir:'):
        p = os.path.join(spec[4:], f'{w}.json')
        return qc.load_json(p) if os.path.exists(p) else None
    sys.exit(f'candidato desconocido: {spec}')


# ---------------------------------------------------------------- libro de afirmaciones (calibración del juez)
def run_ledger(a):
    ledger = qc.load_json(qc.fx('claims', 'claims_ledger.json'))
    groups = {}
    for c in ledger:
        groups.setdefault(c['correo'], []).append(c)
    # correo del libro -> ventana de fixtures (fecha final de la ventana)
    wmap = {'DDEC 1-nov': 'ddecpr_20261031', 'DDEC 2-nov': 'ddecpr_20261101', 'DF 31-oct': 'df_20261030', 'DF 2-nov': 'df_20261101'}
    if a.dry_run:
        print(f'[compose-judge --ledger] {len(ledger)} afirmaciones en {len(groups)} correos → {len(groups)} llamadas con {a.model} (--dry-run: nada se ejecutó)')
        return 0
    qc.load_env()
    rows = []
    for correo, items in groups.items():
        w = next(v for k, v in wmap.items() if correo.startswith(k))
        ctx, samples_txt, _, _ = window_context(w)
        listing = '\n'.join(f"[{c['id']}] ({c['seccion']}) {c['afirmacion']}" for c in items)
        prompt = (ctx + samples_txt + '\n\nAFIRMACIONES DE UN CORREO A VERIFICAR:\n' + listing +
                  '\n\nTAREA: juzga cada afirmación contra los datos y las muestras con sus fechas: verdadera | verdadera_pero_enganosa | exagerada | falsa | sin_respaldo | mal_fechada. '
                  'Devuelve un resultado por id.')
        r = qc.bedrock_tool(a.model, prompt, {'name': 'submit', 'description': 'Entrega el resultado.', 'input_schema': LEDGER_SCHEMA},
                            system=JUDGE_SYSTEM, max_tokens=6000)
        got = {x['id']: x for x in r['results']}
        for c in items:
            g = got.get(c['id'])
            rows.append((c, LEDGER_MAP[c['veredicto_clave']], g['verdict'] if g else None))
    n = len(rows)
    scored = [r for r in rows if r[2]]
    exact = sum(h == j for _, h, j in scored)
    h_def = [r for r in scored if r[1] != 'verdadera']
    caught = sum(j != 'verdadera' for _, h, j in h_def)
    fp = sum(h == 'verdadera' and j != 'verdadera' for _, h, j in scored)
    h_hard = [r for r in scored if r[1] in GRAVES]
    caught_hard = sum(j in GRAVES for _, h, j in h_hard)
    print('## Calibración del juez contra el libro de 127 afirmaciones verificadas a mano')
    print(qc.table(['Medida', 'Resultado'], [
        ['Afirmaciones evaluadas', f'{len(scored)} de {n}'],
        ['Acuerdo exacto de veredicto', qc.pct(exact, len(scored))],
        ['Defectos humanos que el juez también marca (recall)', f'{caught} de {len(h_def)} ({qc.pct(caught, len(h_def))})'],
        ['Defectos graves humanos que el juez marca grave', f'{caught_hard} de {len(h_hard)} ({qc.pct(caught_hard, len(h_hard))})'],
        ['Afirmaciones verdaderas que el juez marca con defecto (falsos positivos)', f'{fp} de {len(scored) - len(h_def)}'],
    ]))
    print('Lectura: el juez ve solo la ventana de muestras; el libro se verificó además con consultas a la base. Un recall bajo no invalida los textos:\n'
          'dice cuánto defecto el juez NO alcanza a ver (límite del arnés, ver docs/tecnica/qa-interpretacion-v1.md).')
    print(qc.USAGE.summary())
    return 0


# ---------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--candidates', default='team,base')
    ap.add_argument('--gate-on', default='team')
    ap.add_argument('--windows')
    ap.add_argument('--limit-windows', type=int, default=None)
    ap.add_argument('--seed', type=int, default=qc.DEFAULT_SEED)
    ap.add_argument('--model', default='sonnet')
    ap.add_argument('--out', default=None, help='directorio de salida (veredictos y compuertas)')
    ap.add_argument('--cached', action='store_true')
    ap.add_argument('--ledger', action='store_true')
    ap.add_argument('--workers', type=int, default=3)
    ap.add_argument('--max-calls', type=int, default=None)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    if a.max_calls:
        qc.USAGE.max_calls = a.max_calls
    if a.ledger:
        return run_ledger(a)

    all_w = sorted(p.name for p in qc.fx('windows').iterdir() if p.is_dir())
    if a.windows:
        ws = a.windows.split(',')
    else:
        ws = qc.sample_ids(all_w, a.limit_windows, a.seed) if a.limit_windows else all_w
    cands = a.candidates.split(',')
    jobs = [(w, c) for w in ws for c in cands if candidate_text(c, w) is not None]
    print(f'[compose-judge] ventanas={len(ws)} candidatos={cands} juez={qc.model_id(a.model)}{" (caché)" if a.cached else ""} → {len(jobs)} textos')
    if a.dry_run:
        for w, c in jobs:
            print(f'  juzgaría {c} de {w}')
        print('  (--dry-run: no se llamó a Bedrock)')
        return 0
    if not a.cached:
        qc.load_env()

    def run(job):
        w, c = job
        ctx, samples_txt, facts, samples = window_context(w)
        dr = candidate_text(c, w)
        if a.cached:
            cp = qc.fx('refs', 'windows', w, f'judge_{c}.json')
            if not cp.exists():
                return {'job': job, 'error': 'sin veredicto en caché para este candidato'}
            j = qc.load_json(cp)
        else:
            j = judge_text(a.model, ctx, samples_txt, dr)
        names = {n for s in samples for n in (s.get('author'), s.get('source'), s.get('parent_author')) if n and any(ch.isdigit() for ch in n)}
        lint = lint_draft(dr, facts, names)
        s = summarize(j)
        s['lint'] = len(lint)
        return {'job': job, 'judge': j, 'summary': s, 'lint': lint, 'headline': dr['headline']}

    res = qc.run_pool(run, jobs, 1 if a.cached else a.workers, every=2, label='textos')
    outdir = a.out
    if outdir:
        for r in res:
            if 'judge' in r:
                qc.save_json({'judge': r['judge'], 'lint': r['lint']}, os.path.join(outdir, 'verdicts', f'{r["job"][0]}.{r["job"][1]}.json'))

    rows = []
    for r in res:
        w, c = r['job']
        if 'error' in r:
            rows.append([w, c, '—', '—', '—', '—', '—', '—', '—', r['error']])
            continue
        s = r['summary']
        rows.append([w, c, s['afirmaciones'], f"{s['con_defecto']} ({qc.pct(s['con_defecto'], s['afirmaciones'])})",
                     f"{s['graves']} ({qc.pct(s['graves'], s['afirmaciones'])})", f"{s['falsas']}/{s['mal_fechadas']}",
                     'SÍ' if s['post_viejo'] else 'no', s['drama'], s['lint'], ''])
    print('## Textos del correo diario — veredictos del juez por ventana')
    print(qc.table(['Ventana', 'Texto', 'Afirm.', 'Con defecto', 'Graves', 'Falsas/Mal fech.', 'Post viejo', 'Drama', 'Lint', 'Nota'], rows,
                   ['l', 'l', 'r', 'r', 'r', 'r', 'l', 'r', 'r', 'l']))

    # agregados por candidato
    agg_rows, gates = [], []
    for c in cands:
        rs = [r for r in res if 'summary' in r and r['job'][1] == c]
        if not rs:
            continue
        S = [r['summary'] for r in rs]
        n = sum(s['afirmaciones'] for s in S)
        d_ = sum(s['con_defecto'] for s in S)
        g_ = sum(s['graves'] for s in S)
        fa = sum(s['falsas'] for s in S)
        mf = sum(s['mal_fechadas'] for s in S)
        old = sum(s['post_viejo'] for s in S)
        dr = [s['drama'] for s in S]
        lint = sum(s['lint'] for s in S)
        agg_rows.append([c, len(rs), n, qc.pct(d_, n, 1), qc.pct(g_, n, 1), fa, mf, old, f'{statistics.median(dr):g} / {max(dr)}', lint])
        if c == a.gate_on:
            pd, pg = qc.pctv(d_, n), qc.pctv(g_, n)
            part = len(rs) < len(all_w)
            jn = ('veredictos en caché del juez Opus (2-nov)' if a.cached else
                  f'juez {a.model}' + ('' if a.model == 'opus' else ' (las compuertas se calibraron con juez Opus; Sonnet es más estricto)'))
            gates.append(qg.make_gate('claims_defect', pd is not None and pd <= 10.0, f'{pd:.1f} %' if pd is not None else '—', n, jn, part))
            gates.append(qg.make_gate('claims_severe', pg is not None and pg <= 5.0 and fa == 0 and mf == 0,
                                      f'{pg:.1f} % graves; {fa} falsas; {mf} mal fechadas' if pg is not None else '—', n, '', part))
            gates.append(qg.make_gate('old_post', old == 0, f'{old} de {len(rs)} ventanas', len(rs), '', part))
            gates.append(qg.make_gate('drama', statistics.median(dr) <= 1 and max(dr) <= 2, f'mediana {statistics.median(dr):g}, máximo {max(dr)}', len(rs), '', part))
            gates.append(qg.make_gate('lint', lint == 0, f'{lint} residuos', len(rs), '', part))
    print('\n## Agregado por candidato (compuertas sobre «' + a.gate_on + '»)')
    print(qc.table(['Texto', 'Ventanas', 'Afirm.', '% defecto', '% graves', 'Falsas', 'Mal fech.', 'Post viejo', 'Drama med./máx.', 'Lint'], agg_rows,
                   ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']))
    if outdir:
        qg.save_gates(gates, os.path.join(outdir, 'gates.compose.json'))
    print()
    print(qg.render(gates, '### Compuertas evaluadas en este paso'))
    print(qc.USAGE.summary())
    return 0


if __name__ == '__main__':
    sys.exit(main())
