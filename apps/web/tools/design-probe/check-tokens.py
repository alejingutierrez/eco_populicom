#!/usr/bin/env python3
"""Comprueba que todo `var(--x)` usado exista declarado.

Por qué existe: `screens.js` llegó a referenciar `--verdict-*` ocho veces
mientras `tokens.css` lo declaraba cero, y las bandas de Brand Health y
Polarización se dibujaban con un color inexistente. La sonda de color NO puede
ver eso: un `var()` sin declarar no resuelve a "un color fuera de la paleta",
resuelve a nada. Es una clase entera de defecto que sólo se caza comparando
referencias contra declaraciones.

Uso:  python3 apps/web/tools/design-probe/check-tokens.py
Sale con código 1 si encuentra referencias huérfanas, para poder usarlo en CI.
"""
import os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
PROTO = os.path.abspath(os.path.join(HERE, '..', '..', 'public', 'eco-prototype'))

DECL_FILES = ['tokens.css', 'index.html']
USE_FILES = ['index.html', 'screens.js', 'shell.js', 'charts.js', 'data.js',
             'terms-cloud.js', 'chat-drawer.js', 'app.js', 'icons.js']

declared = set()
for f in DECL_FILES:
    p = os.path.join(PROTO, f)
    if not os.path.exists(p):
        continue
    src = open(p, encoding='utf-8').read()
    # `--x: valor` en cualquier bloque (incluye :root, [data-mode], @media)
    declared |= set(re.findall(r'(--[A-Za-z0-9_-]+)\s*:', src))

# Propiedades LOCALES puestas en línea desde JS: `style={{ '--x': valor }}`. Son
# declaraciones legítimas, sólo que en tiempo de render y por elemento.
for f in USE_FILES:
    p2 = os.path.join(PROTO, f)
    if os.path.exists(p2):
        declared |= set(re.findall(r'[\'"](--[A-Za-z0-9_-]+)[\'"]\s*:',
                                   open(p2, encoding='utf-8').read()))

used = collections.defaultdict(list)
for f in USE_FILES:
    p = os.path.join(PROTO, f)
    if not os.path.exists(p):
        continue
    for i, line in enumerate(open(p, encoding='utf-8'), 1):
        for m in re.finditer(r'var\((--[A-Za-z0-9_-]+)\s*(,?)', line):
            # Un `var(--x, fallback)` degrada con gracia: si falta el token se
            # pinta el respaldo. Sin fallback no se pinta NADA, que es lo que
            # pasaba con --verdict-*: la banda salía invisible.
            used[m.group(1)].append((f, i, bool(m.group(2))))

# Leaflet y las propias hojas de terceros declaran las suyas; se ignoran.
IGNORE_PREFIX = ('--leaflet',)

orphans = {k: v for k, v in used.items()
           if k not in declared and not k.startswith(IGNORE_PREFIX)}
# Sólo rompe la build lo que NO tiene respaldo en ningún uso.
graves = {k: v for k, v in orphans.items() if any(not fb for *_, fb in v)}

print(f'tokens declarados: {len(declared)}')
print(f'tokens usados:     {len(used)}')
if orphans:
    print(f'\nHUÉRFANOS ({len(orphans)}): usados pero nunca declarados')
    for k in sorted(orphans, key=lambda x: -len(orphans[x])):
        sites = orphans[k]
        where = ', '.join(f'{f}:{i}' for f, i, _ in sites[:4])
        sin_fb = sum(1 for *_, fb in sites if not fb)
        sev = 'SIN FALLBACK' if sin_fb else 'con fallback'
        print(f'  {k:24} {len(sites):3} usos  {sev:13} {where}')
    if graves:
        print(f'\n{len(graves)} de ellos SIN fallback: se pintan como nada.')
        sys.exit(1)
    print('\nninguno crítico: todos tienen respaldo.')

# --- Colisiones de valor entre familias semánticas ---------------------------
# Dos tokens con el MISMO valor y significados distintos son indistinguibles en
# pantalla. Es la clase que produjo el peor hallazgo de la auditoría:
# --narr-peaking era el mismo hex que --accent, así que estado de narrativa,
# selección y marca se leían igual; y --emo-ira era idéntico a --neg. Ninguna
# sonda de color puede verlo — los dos valores SON del sistema.
FAMILIAS = {
    'marca': ('--accent',),
    'semantico': ('--pos', '--neg', '--warn', '--info', '--neu'),
    'texto': ('--text', '--text-2', '--text-3'),
    'narrativa': ('--narr-',),
    'emocion': ('--emo-',),
    'categoria': ('--cat-',),
    'veredicto': ('--verdict-',),
    'metrica': ('--metric-',),
}


def familia(nombre):
    for fam, pres in FAMILIAS.items():
        for pre in pres:
            if nombre == pre or (pre.endswith('-') and nombre.startswith(pre)):
                return fam
    return None


# Sólo se comparan valores literales (#hex / rgb). Los alias por var() son
# deliberados y se ven en el nombre.
valores = collections.defaultdict(list)
for f in DECL_FILES:
    p = os.path.join(PROTO, f)
    if not os.path.exists(p):
        continue
    for m in re.finditer(r'(--[A-Za-z0-9_-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})\s*;', open(p, encoding='utf-8').read()):
        fam = familia(m.group(1))
        if fam:
            valores[m.group(2).lower()].append((m.group(1), fam))

colisiones = []
for val, tks in valores.items():
    fams = {f for _, f in tks}
    if len(fams) > 1:
        colisiones.append((val, sorted(set(tks))))

if colisiones:
    # AVISO, no fallo. Las 14 colisiones que hay hoy son una sola decisión
    # pendiente: los siete estados del ciclo de vida de narrativas reutilizan la
    # paleta CATEGÓRICA (--narr-peaking es --cat-2, que además es
    # --metric-polarization) y --narr-dormant es el gris de TEXTO. Elegir siete
    # valores propios es una decisión de paleta, no un arreglo mecánico, así que
    # romper la build de todo el equipo por ella sería desproporcionado.
    # Cuando esa paleta se decida, este bloque pasa a sys.exit(1) y la clase
    # queda cerrada para siempre.
    print(f'\nAVISO — colisiones de valor ({len(colisiones)}): mismo color, familias distintas')
    for val, tks in colisiones:
        print(f'  {val}  ' + ' = '.join(f'{n} ({f})' for n, f in tks))
    print('  Dos significados con un valor son indistinguibles en pantalla.')
    print('  Pendiente: paleta propia para el ciclo de vida de narrativas.')

unused = sorted(d for d in declared
                if d not in used and not d.startswith(IGNORE_PREFIX))
print('\nsin referencias huérfanas ✔')
if unused:
    # No es un error: un token puede existir para el especimen o para el futuro.
    # Pero si son muchos, la paleta está declarando más de lo que el producto usa.
    print(f'declarados sin usar ({len(unused)}): ' + ', '.join(unused[:14])
          + (' …' if len(unused) > 14 else ''))
