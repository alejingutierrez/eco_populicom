#!/usr/bin/env python3
"""Comprueba que repro.ts (DB de producción, SOLO LECTURA) sigue reproduciendo una ventana de fixtures/windows.

Corre repro.ts sin LLM para la ventana pedida y compara totales y serie diaria contra el fixture. Una diferencia
no es un fallo del arnés: son llegadas tardías o reclasificaciones desde el 2-nov (el fixture es una foto). Úsalo
para (a) validar que el entorno puede leer la base y que el código de @eco/shared sigue compilando, y (b) medir
cuánto cambian los conteos de una ventana pasada.

Uso: python3 scripts/qa/repro-check.py [--window ddecpr_20261031] [--tsx /ruta/a/tsx]
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import qa_common as qc  # noqa: E402


def find_tsx(explicit):
    for c in (explicit, os.environ.get('TSX_BIN'), str(qc.REPO / 'node_modules/.bin/tsx'), shutil.which('tsx')):
        if c and os.path.exists(c):
            return [c]
    for p in qc.env_candidates():  # worktree: el node_modules vive en el checkout principal
        cand = p.parent / 'node_modules/.bin/tsx'
        if cand.exists():
            return [str(cand)]
    return ['npx', '--no-install', 'tsx']


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--window', default='ddecpr_20261031')
    ap.add_argument('--tsx')
    a = ap.parse_args()
    slug, ymd = a.window.rsplit('_', 1)
    end = f'{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}'
    fixture = qc.load_json(qc.fx('windows', a.window, 'window.json'))
    with tempfile.TemporaryDirectory(prefix='ecoqa-') as td:
        out = os.path.join(td, 'w.json')
        r = subprocess.run(find_tsx(a.tsx) + [str(qc.QA_DIR / 'repro.ts'), '--slug', slug, '--end', end, '--quiet', '--out', out],
                           capture_output=True, text=True, cwd=str(qc.REPO))
        if r.returncode != 0:
            print('repro.ts falló:\n' + (r.stderr or r.stdout)[-800:])
            return 1
        now = qc.load_json(out)
    ft, nt = fixture['totals'], now['totals']
    print(f'## repro-check {a.window} (ventana {now["window"]["startYmd"]} → {now["window"]["endYmd"]})')
    print(qc.table(['', 'negativas', 'neutrales', 'positivas', 'total'],
                   [['fixture (2-nov)'] + [ft[k] for k in ('negative', 'neutral', 'positive', 'total')],
                    ['base hoy'] + [nt[k] for k in ('negative', 'neutral', 'positive', 'total')]], ['l', 'r', 'r', 'r', 'r']))
    fs = [d['negative'] + d['neutral'] + d['positive'] for d in fixture['dailySeries']]
    ns = [d['negative'] + d['neutral'] + d['positive'] for d in now['dailySeries']]
    print('serie diaria fixture:', fs)
    print('serie diaria hoy    :', ns)
    same = ft == nt and fs == ns
    print('RESULTADO:', 'idéntico a la foto del 2-nov' if same else 'difiere de la foto del 2-nov (llegadas tardías o reclasificación); no es un fallo del arnés')
    return 0


if __name__ == '__main__':
    sys.exit(main())
