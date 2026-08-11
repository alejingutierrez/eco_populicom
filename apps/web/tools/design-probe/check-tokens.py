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

unused = sorted(d for d in declared
                if d not in used and not d.startswith(IGNORE_PREFIX))
print('\nsin referencias huérfanas ✔')
if unused:
    # No es un error: un token puede existir para el especimen o para el futuro.
    # Pero si son muchos, la paleta está declarando más de lo que el producto usa.
    print(f'declarados sin usar ({len(unused)}): ' + ', '.join(unused[:14])
          + (' …' if len(unused) > 14 else ''))
