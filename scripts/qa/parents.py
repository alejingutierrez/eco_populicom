#!/usr/bin/env python3
"""Tasa de resolución del post padre de los comentarios de Facebook e Instagram (spec sección 7; compuerta 13.2 ≥ 90 %).

SOLO LECTURA sobre producción vía lib/q.py: dos SELECT acotados por agencia y fecha (comentarios de la ventana y los
posts candidatos de los últimos N días), con el cruce hecho aquí en Python; nunca un JOIN con LIKE sobre `mentions`.

Regla (spec sección 7):
  Facebook   GUID de comentario `<postId>_<commentId>`; el padre es la mención de la MISMA agencia cuyo bw_guid termina en `_<postId>`.
  Instagram  GUID de comentario `<shortcode>#<commentId>`; el padre es la mención con bw_guid = `<shortcode>`.
  LinkedIn   se marca parent_unknown por diseño y no entra en la compuerta.
Mientras WP-1 no añada `mentions.parent_mention_id`, esto mide si el comentario ES RESOLUBLE con la regla de GUID.
Cuando la columna exista, el script reporta además la tasa real de filas con parent_mention_id no nulo.

Uso:
  python3 scripts/qa/parents.py [--slugs ddecpr,df] [--end 2026-11-01] [--days 7] [--lookback 120] [--gates-out out/gates.parents.json]
"""
import argparse
import collections
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import qa_common as qc  # noqa: E402
import qa_gates as qg  # noqa: E402
import q  # noqa: E402

COMMENT_FB = "url LIKE '%#channels_comment%'"
COMMENT_IG = "(pub_type = 'INSTAGRAM_GRAPH_BUSINESS' AND bw_guid LIKE '%#%')"


def ymd(d):
    return d.strftime('%Y-%m-%d')


def run_agency(slug, end, days, lookback, max_comments):
    start = end - dt.timedelta(days=days - 1)
    pstart = start - dt.timedelta(days=lookback)
    aid = f"(SELECT id FROM agencies WHERE slug = '{slug}')"
    rng = lambda a, b: f"published_at >= '{ymd(a)}'::date + interval '4 hours' AND published_at < '{ymd(b + dt.timedelta(days=1))}'::date + interval '4 hours'"
    comments = q.select(
        f"SELECT bw_guid, pub_type, ({COMMENT_FB}) AS is_fb FROM mentions WHERE agency_id = {aid} AND is_duplicate = false AND {rng(start, end)} "
        f"AND ({COMMENT_FB} OR {COMMENT_IG}) ORDER BY published_at DESC LIMIT {max_comments}")
    posts = q.select(
        f"SELECT bw_guid, pub_type FROM mentions WHERE agency_id = {aid} AND {rng(pstart, end)} AND pub_type IN ('FACEBOOK','INSTAGRAM_GRAPH_BUSINESS') "
        f"AND NOT ({COMMENT_FB}) AND NOT {COMMENT_IG} AND bw_guid IS NOT NULL ORDER BY published_at DESC LIMIT 30000")
    if len(posts) >= 30000:
        print(f'  aviso: {slug}: las publicaciones propias llegaron al tope de 30000 (LIMIT); los padres más viejos pueden faltar y '
              'subestimar la resolución. Acorta --lookback.', file=sys.stderr)
    # los shortcodes de Instagram pueden contener «_», así que se separan por pub_type y no por la forma del GUID
    fb_post_ids = {p['bw_guid'].split('_', 1)[1] for p in posts if p['pub_type'] == 'FACEBOOK' and '_' in (p['bw_guid'] or '')}
    ig_codes = {p['bw_guid'] for p in posts if p['pub_type'] == 'INSTAGRAM_GRAPH_BUSINESS'}
    res = collections.defaultdict(lambda: [0, 0])  # plataforma -> [comentarios, resueltos]
    unresolved = []
    for c in comments:
        g = c['bw_guid'] or ''
        if str(c['is_fb']).lower() in ('true', 't', '1'):
            plat, ok = 'FB', ('_' in g and g.split('_', 1)[0] in fb_post_ids)
        else:
            plat, ok = 'IG', ('#' in g and g.split('#', 1)[0] in ig_codes)
        res[plat][0] += 1
        res[plat][1] += ok
        if not ok and len(unresolved) < 5:
            unresolved.append((plat, g[:40]))
    col = None
    try:
        has = q.select("SELECT column_name FROM information_schema.columns WHERE table_name = 'mentions' AND column_name = 'parent_mention_id' LIMIT 1")
        if has:
            r = q.select(f"SELECT count(*) AS n, count(parent_mention_id) AS r FROM mentions WHERE agency_id = {aid} AND is_duplicate = false AND {rng(start, end)} "
                         f"AND ({COMMENT_FB} OR {COMMENT_IG})")[0]
            col = (int(r['n']), int(r['r']))
    except SystemExit:
        pass
    return start, end, dict(res), len(comments), len(posts), unresolved, col, len(comments) >= max_comments


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--slugs', default='ddecpr,df')
    ap.add_argument('--end', help='último día de la ventana (YYYY-MM-DD, hora PR); por defecto ayer')
    ap.add_argument('--days', type=int, default=7)
    ap.add_argument('--lookback', type=int, default=120, help='días hacia atrás en que se buscan los posts padre')
    ap.add_argument('--max-comments', type=int, default=4000)
    ap.add_argument('--gates-out')
    a = ap.parse_args()
    end = dt.date.fromisoformat(a.end) if a.end else (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=4)).date() - dt.timedelta(days=1)

    tot = collections.defaultdict(lambda: [0, 0])
    rows, notes = [], []
    for slug in a.slugs.split(','):
        start, e, res, nc, npst, unres, col, capped = run_agency(slug, end, a.days, a.lookback, a.max_comments)
        for plat in ('FB', 'IG'):
            n, ok = res.get(plat, [0, 0])
            tot[plat][0] += n
            tot[plat][1] += ok
            rows.append([slug, plat, f'{ymd(start)} → {ymd(e)}', n, ok, qc.pct(ok, n, 1), (f'{col[1]} de {col[0]}' if col else 'columna aún no existe')])
        if capped:
            notes.append(f'{slug}: se alcanzó --max-comments; la tasa es de los más recientes')
        if unres:
            notes.append(f'{slug}: ejemplos sin padre (plataforma, GUID): ' + '; '.join(f'{p} {g}' for p, g in unres))
    print('## Resolución de padres de comentarios (regla de GUID, spec sección 7)')
    print(qc.table(['Agencia', 'Plataforma', 'Ventana', 'Comentarios', 'Con padre', 'Tasa', 'parent_mention_id no nulo'], rows, ['l', 'l', 'l', 'r', 'r', 'r', 'l']))
    vals, parts = [], []
    for plat in ('FB', 'IG'):
        n, ok = tot[plat]
        if n >= 10:
            vals.append(100 * ok / n)
            parts.append(f'{plat} {100 * ok / n:.1f} % ({ok}/{n})')
        else:
            notes.append(f'{plat}: solo {n} comentarios en la ventana; no alcanza para medir (se omite de la compuerta)')
    gate = (qg.ge('parents', min(vals), sum(tot[p][0] for p in tot), ' · '.join(parts)) if vals else qg.make_gate('parents', None, '—', 0, 'sin comentarios suficientes'))
    if notes:
        gate['note'] = ' | '.join(notes)
        print('Notas:\n' + '\n'.join('  - ' + x for x in notes))
    gate['display'] = ' · '.join(parts) if parts else gate['display']
    if a.gates_out:
        qg.save_gates([gate], a.gates_out)
    print()
    print(qg.render([gate], '### Compuertas evaluadas en este paso'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
