#!/usr/bin/env python3
"""κ de Cohen entre las etiquetas de una persona (hoja de revisión a ciegas de 48 ítems) y las del sistema.

Sin llamadas a Bedrock ni a la base de datos. La compuerta 13.2 es κ ≥ 0.6 en el SENTIMIENTO (S); H (hecho adverso)
y P (pertinencia) se reportan con el mismo umbral como informativos.

Uso:
  python3 scripts/qa/human-kappa.py --sheet fixtures/human-review/hoja_revision_ciega.md   # la hoja rellenada a mano
  python3 scripts/qa/human-kappa.py --csv respuestas.csv                                   # o CSV: n,S,H,P (ver respuestas-plantilla.csv)
        [--system out/runs/ddec208.json,out/runs/df397.json] [--gates-out out/gates.kappa.json]
  python3 scripts/qa/human-kappa.py --demo        # prueba de humo con etiquetas sintéticas (NO es una revisión humana)

Etiquetas del sistema: por defecto las corridas de referencia (fixtures/refs, rúbrica v2 del 2-nov). Pasa --system con una o
más corridas de classify-lab.py (o cualquier JSON [{id, sentiment, adverse_fact, pertinence}]) para medir al sistema vigente.
Si una hoja está vacía o incompleta, el paso reporta «N/D» (no falla): la compuerta se cierra cuando la persona la termina.

Valores aceptados — S: positivo|neutral|negativo (también pos/neu/neg, +/0/−) · H: si|no (también s/n, true/false)
                    P: alta|media|baja (también a/m/b).
"""
import argparse
import csv
import os
import random
import re
import sys
import unicodedata

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import qa_common as qc  # noqa: E402
import qa_gates as qg  # noqa: E402

S_MAP = {'positivo': 'positivo', 'pos': 'positivo', 'p': 'positivo', '+': 'positivo', 'neutral': 'neutral', 'neu': 'neutral', 'neutro': 'neutral',
         '0': 'neutral', 'negativo': 'negativo', 'neg': 'negativo', '-': 'negativo', '−': 'negativo'}
H_MAP = {'si': True, 's': True, 'true': True, '1': True, 'no': False, 'n': False, 'false': False, '0': False}
P_MAP = {'alta': 'alta', 'a': 'alta', 'media': 'media', 'm': 'media', 'baja': 'baja', 'b': 'baja'}


def norm(v):
    v = unicodedata.normalize('NFKD', (v or '').strip().lower())
    return ''.join(c for c in v if not unicodedata.combining(c)).strip('_ .')


def parse_sheet(path):
    """Lee la hoja .md: bloques «**A1.**» seguidos de una línea «S: … H: … P: …». Devuelve {n: (S, H, P)} solo con lo rellenado."""
    txt = open(path, encoding='utf-8').read()
    out = {}
    for m in re.finditer(r'\*\*([AB]\d+)\.\*\*(.*?)(?=\n\*\*[AB]\d+\.\*\*|\Z)', txt, re.S):
        n, body = m.group(1), m.group(2)
        mm = re.search(r'^\s*S:\s*(.*?)\s+H:\s*(.*?)\s+P:\s*(.*?)\s*$', body, re.M)
        if mm:
            out[n] = tuple(norm(x) for x in mm.groups())
    return out


def parse_csv(path):
    out = {}
    with open(path, encoding='utf-8', newline='') as f:
        for r in csv.DictReader(f):
            out[r['n'].strip()] = (norm(r.get('S')), norm(r.get('H')), norm(r.get('P')))
    return out


def cohen_kappa(a, b, labels=None):
    """κ de Cohen sin ponderar. Devuelve (κ, acuerdo observado, n)."""
    n = len(a)
    if not n:
        return None, None, 0
    labels = labels or sorted(set(a) | set(b))
    po = sum(x == y for x, y in zip(a, b)) / n
    pe = sum((a.count(l) / n) * (b.count(l) / n) for l in labels)
    if pe == 1:
        return (1.0 if po == 1 else 0.0), po, n
    return (po - pe) / (1 - pe), po, n


def load_system(paths):
    sysl = {}
    for p in paths:
        for d in qc.load_json(p):
            if 'error' not in d:
                sysl[d['id']] = d
    return sysl


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--sheet')
    ap.add_argument('--csv')
    ap.add_argument('--system', help='corridas del sistema (coma-separadas); por defecto fixtures/refs')
    ap.add_argument('--gates-out')
    ap.add_argument('--demo', action='store_true')
    a = ap.parse_args()

    key = qc.load_json(qc.fx('human-review', 'hoja_clave_ids.json'))
    kid = {k['n']: k['id'] for k in key}
    if a.system:
        sysl = load_system(a.system.split(','))
    else:
        sysl = load_system([str(qc.fx('refs', f)) for f in ('ddec208.json', 'df397.json')])

    if a.demo:  # humano sintético: copia al sistema y cambia ~20 % de las etiquetas S con semilla fija
        rng = random.Random(qc.DEFAULT_SEED)
        human = {}
        for n, i in kid.items():
            s = sysl.get(i)
            if not s:
                continue
            sent = s['sentiment'] if rng.random() > 0.2 else rng.choice(['positivo', 'neutral', 'negativo'])
            human[n] = (sent, 'si' if s.get('adverse_fact') else 'no', s['pertinence'])
        src = 'DEMO sintética (no es una revisión humana)'
    elif a.csv:
        human, src = parse_csv(a.csv), a.csv
    elif a.sheet:
        human, src = parse_sheet(a.sheet), a.sheet
    else:
        ap.error('indica --sheet, --csv o --demo')

    S_h, S_s, H_h, H_s, P_h, P_s = [], [], [], [], [], []
    bad = []
    for n in sorted(kid, key=lambda x: (x[0], int(x[1:]))):
        h = human.get(n)
        s = sysl.get(kid[n])
        if not h or not s:
            continue
        sv, hv, pv = S_MAP.get(h[0]), H_MAP.get(h[1]), P_MAP.get(h[2])
        if sv is None and hv is None and pv is None:
            continue  # ítem sin rellenar
        if sv is None or hv is None or pv is None:
            bad.append(n)
            continue
        S_h.append(sv); S_s.append(s['sentiment'])
        H_h.append(hv); H_s.append(bool(s.get('adverse_fact')))
        P_h.append(pv); P_s.append(s['pertinence'])

    print(f'[human-kappa] fuente: {src} · ítems completos: {len(S_h)} de {len(kid)}' + (f' · con valores no reconocidos: {", ".join(bad)}' if bad else ''))
    gates = []
    if len(S_h) < len(kid):
        msg = 'hoja sin rellenar' if not S_h else f'hoja incompleta ({len(S_h)} de {len(kid)})'
        print(f'[human-kappa] {msg}: la compuerta queda N/D hasta que la persona clasifique los {len(kid)} ítems.')
        gates.append(qg.make_gate('kappa', None, '—', len(S_h), msg + ' (compuerta previa a la activación, spec 13.5)'))
    if S_h:
        ks, pos_, n_ = cohen_kappa(S_h, S_s, ['negativo', 'neutral', 'positivo'])
        kh, poh, _ = cohen_kappa(H_h, H_s, [True, False])
        kp, pop_, _ = cohen_kappa(P_h, P_s, ['alta', 'media', 'baja'])
        rows = [['S sentimiento (compuerta)', f'{ks:.2f}', qc.pct(pos_ * n_, n_), n_, 'PASA' if ks >= 0.6 else 'FALLA'],
                ['H hecho adverso (informativo)', f'{kh:.2f}', qc.pct(poh * n_, n_), n_, 'PASA' if kh >= 0.6 else 'FALLA'],
                ['P pertinencia (informativo)', f'{kp:.2f}', qc.pct(pop_ * n_, n_), n_, 'PASA' if kp >= 0.6 else 'FALLA']]
        print(qc.table(['Etiqueta', 'κ de Cohen', 'Acuerdo', 'n', 'κ ≥ 0.6'], rows, ['l', 'r', 'r', 'r', 'l']))
        for lab, hh, ss in (('S', S_h, S_s),):
            cm = {}
            for x, y in zip(hh, ss):
                cm[(x, y)] = cm.get((x, y), 0) + 1
            print('Matriz S (fila = persona, columna = sistema):')
            labs = ['negativo', 'neutral', 'positivo']
            print(qc.table([''] + labs, [[x] + [cm.get((x, y), 0) for y in labs] for x in labs], ['l', 'r', 'r', 'r']))
        if len(S_h) == len(kid):
            # en --demo la compuerta queda N/D: κ sintético no es una revisión humana y no debe leerse como compuerta cerrada
            gates = [qg.make_gate('kappa', None if a.demo else ks >= 0.6, f'κ = {ks:.2f} (S){" DEMO" if a.demo else ""}', n_,
                                  'DEMO sintética: no cuenta como revisión humana' if a.demo else '')]
    if a.gates_out:
        qg.save_gates(gates, a.gates_out)
    print()
    print(qg.render(gates, '### Compuertas evaluadas en este paso'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
