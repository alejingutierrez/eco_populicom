#!/usr/bin/env python3
"""Genera la hoja de revisión humana de TEXTOS DE CORREO (spec 13.5: «una muestra de 12 textos de correo»).

12 textos = 6 ventanas × {modelo único de producción, equipo de agentes}, mezclados con semilla fija y sin decir cuál es cuál.
Escribe fixtures/human-review/hoja_textos_correo.md (para la persona) y hoja_textos_clave.json (qué texto es de qué ventana y
de qué sistema: NO se le muestra a la persona hasta que termine).

Uso: python3 scripts/qa/tools/make-text-sheet.py [--seed 20261102]
"""
import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
import qa_common as qc  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=qc.DEFAULT_SEED)
    a = ap.parse_args()
    ws = sorted(p.name for p in qc.fx('windows').iterdir() if p.is_dir())
    items = [(w, c) for w in ws for c in ('base', 'team')]
    random.Random(a.seed).shuffle(items)
    out = ['# Hoja de revisión a ciegas de textos de correo (12)', '',
           'Lee cada texto como lo leería el cliente y verifícalo contra los DATOS de su ventana (cifras, fechas, quién dijo qué). '
           'Las muestras completas de cada ventana están en `fixtures/windows/<ventana>/samples.json`; los hechos numéricos van abajo de cada texto. '
           'No sabes qué sistema escribió cada texto.', '',
           'Para cada texto anota:', '- **D**: cuántas afirmaciones tienen un defecto (cifra distinta, cuantificador exagerado, fecha o autor equivocado, '
           'una publicación vieja contada como noticia del día, sin respaldo).',
           '- **G**: cuántas de esas son GRAVES (falsas, sin respaldo o mal fechadas).',
           '- **Drama**: dramatismo del titular de 0 (literal y sobrio) a 5 (tabloide).',
           '- **Viejo**: ¿presenta como noticia del día una publicación de más de 2 días sin decirlo? (si/no)', '']
    key = []
    for k, (w, c) in enumerate(items, 1):
        t = qc.load_json(qc.fx('windows', w, f'text.{c}.json'))
        facts = qc.load_json(qc.fx('windows', w, 'facts.json'))
        win = qc.load_json(qc.fx('windows', w, 'window.json'))
        out += [f'## T{k}. Ventana `{w}` ({win["agency"]["name"]}, {win["window"]["startYmd"]} a {win["window"]["endYmd"]})', '',
                f'**Titular:** {t["headline"]}', '', f'**Párrafo:** {t["paragraph"]}', '', '**Viñetas:**'] + [f'- {x}' for x in t['highlights']] + ['', '**Insights:**']
        out += [f'- [{lab}] {x}' for lab, v in t['insights'].items() for x in v]
        out += ['', '<details><summary>Hechos de la ventana</summary>', ''] + [f'- {v[2]}: {v[1]}' for kf, v in facts.items() if not kf.startswith('series_')] + ['', '</details>', '',
                'D: ____  G: ____  Drama: ____  Viejo: ____', '']
        key.append({'n': f'T{k}', 'window': w, 'system': c})
    p = qc.fx('human-review', 'hoja_textos_correo.md')
    p.write_text('\n'.join(out) + '\n', encoding='utf-8')
    qc.save_json(key, qc.fx('human-review', 'hoja_textos_clave.json'))
    print('escrito', p)


if __name__ == '__main__':
    main()
