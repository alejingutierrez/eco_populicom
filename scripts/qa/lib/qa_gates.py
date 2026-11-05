#!/usr/bin/env python3
"""Compuertas de aceptación (spec 13.2) y resumen final del arnés.

Como biblioteca: `make_gate(id, value, display, n=None, note='')` devuelve un dict con estado PASA/FALLA.
Como programa:   `python3 qa_gates.py summary --out DIR` junta los gates.*.json de DIR y imprime la tabla 13.2.
                 Código de salida 1 si alguna compuerta FALLA (las N/D no fallan).
"""
import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_common import table  # noqa: E402

# id -> (nombre de la compuerta tal como está en el spec 13.2, umbral en texto, comparador, valor umbral)
GATES = [
    ('df_agreement', 'Sentimiento DF, acuerdo con juez', '≥ 75 %', 'ge', 75.0),
    ('df_neg_precision', 'Sentimiento DF, precisión de negativos', '≥ 85 %', 'ge', 85.0),
    ('ddec_tone', 'Sentimiento DDEC, acuerdo por tono', '≥ 75 %', 'ge', 75.0),
    ('stability', 'Estabilidad entre corridas (sentimiento, pertinencia)', '≥ 95 %', 'ge', 95.0),
    ('adverse_fact', 'Hecho adverso, acuerdo con juez', '≥ 85 %', 'ge', 85.0),
    ('parents', 'Resolución de padres de comentarios (FB e IG)', '≥ 90 % FB e IG', 'ge', 90.0),
    ('claims_defect', 'Textos del equipo, afirmaciones con defecto', '≤ 10 %', 'le', 10.0),
    ('claims_severe', 'Textos del equipo, defectos graves / falsas / mal fechadas', '≤ 5 %; 0 falsas; 0 mal fechadas', 'le', 5.0),
    ('old_post', '«Post viejo presentado como noticia del día» (ventanas)', '0 en las 6 ventanas', 'le', 0.0),
    ('drama', 'Dramatismo del titular (0 a 5)', 'mediana ≤ 1, máximo ≤ 2', 'le', 1.0),
    ('lint', 'Lint de código sobre el texto final', '0 residuos', 'le', 0.0),
    ('kappa', 'Revisión humana a ciegas (hoja de 48 ítems)', 'κ ≥ 0.6 con el sistema', 'ge', 0.6),
]
BY_ID = {g[0]: g for g in GATES}


def make_gate(gid, ok, display, n=None, note='', partial=False):
    """ok: True/False/None (None = no se pudo medir). `display` es lo que se imprime en la columna Resultado.
    partial=True marca un subconjunto del conjunto de oro (--limit, menos ventanas): se imprime con `*` (indicativo)."""
    status = 'N/D' if ok is None else ('PASA' if ok else 'FALLA')
    return {'id': gid, 'status': status, 'display': display, 'n': n, 'note': note, 'partial': bool(partial)}


def ge(gid, value, n=None, note='', unit=' %', nd=1, partial=False):
    """Compuerta de tipo «valor ≥ umbral»."""
    if value is None:
        return make_gate(gid, None, '—', n, note or 'sin datos')
    thr = BY_ID[gid][4]
    return make_gate(gid, value >= thr, f'{value:.{nd}f}{unit}', n, note, partial)


def save_gates(gates, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(gates, f, ensure_ascii=False, indent=1)


def render(gates, title='Compuertas de aceptación (spec 13.2)'):
    by = {g['id']: g for g in gates}
    rows = []
    for gid, name, thr, _, _ in GATES:
        g = by.get(gid)
        if g is None:
            continue
        n = '' if g.get('n') is None else str(g['n'])
        note = '*' if (g.get('partial') and g['status'] != 'N/D') else ''
        rows.append([name, thr, g['display'], n, g['status'] + note])
    out = [title, table(['Compuerta', 'Umbral', 'Resultado', 'n', 'Estado'], rows, ['l', 'l', 'l', 'r', 'l'])]
    if any(r[4].endswith('*') for r in rows):
        out.append('* Subconjunto del conjunto de oro (--limit o menos ventanas): indicativo; el spec fija los umbrales sobre los conjuntos completos.')
    notes = [f'  - {g["id"]}: {g["note"]}' for g in gates if g.get('note')]
    if notes:
        out.append('Notas:\n' + '\n'.join(notes))
    return '\n'.join(out)


def summary(out_dir, strict=True):
    merged = {}
    for p in sorted(glob.glob(os.path.join(out_dir, 'gates.*.json'))):
        with open(p, encoding='utf-8') as f:
            for g in json.load(f):
                merged[g['id']] = g
    for gid, name, *_ in GATES:  # lo no ejecutado se lista como N/D
        merged.setdefault(gid, make_gate(gid, None, 'no ejecutado'))
    gates = [merged[g[0]] for g in GATES]
    print(render(gates))
    nf = sum(g['status'] == 'FALLA' for g in gates)
    npass = sum(g['status'] == 'PASA' for g in gates)
    nnd = sum(g['status'] == 'N/D' for g in gates)
    print(f'\nResumen: {npass} PASA · {nf} FALLA · {nnd} N/D')
    return 1 if (nf and strict) else 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['summary'])
    ap.add_argument('--out', required=True)
    ap.add_argument('--no-strict', action='store_true', help='código de salida 0 aunque haya FALLA')
    a = ap.parse_args()
    sys.exit(summary(a.out, not a.no_strict))
