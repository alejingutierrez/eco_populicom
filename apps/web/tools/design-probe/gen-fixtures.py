#!/usr/bin/env python3
"""Genera el dataset del harness: `fixtures/eco-data-remote.json`.

En producción Next.js inyecta `window.ECO_DATA_REMOTE` en la página y la SPA lo
mezcla sobre los `_mocks` de data.js, que están casi todos vacíos. Sin este
archivo el harness renderiza la SPA con listas vacías y las pantallas salen en
blanco — o peor, crashean, y entonces TODAS las métricas de las sondas "mejoran"
porque no hay nada que medir.

Dos reglas de este generador:

  1. DETERMINISTA. Nada de RNG: dos corridas tienen que dar el mismo dataset, o
     dos mediciones no son comparables.
  2. CON CASOS BORDE A PROPÓSITO. El defecto vive en el caso raro: métricas en
     null, deltas de signo mezclado, un delta sin base, enums fuera de rango,
     una serie con hueco. Un fixture "bonito" esconde justo lo que se audita.

Uso:  python3 gen-fixtures.py
"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixtures')
os.makedirs(FIX, exist_ok=True)

DAYS = ['2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31',
        '2026-08-01', '2026-08-02', '2026-08-03']
VOL = [106, 89, 21, 67, 56, 148, 171]        # el 21 es un valle real, no ruido


def disp(word, value, short, tone, color):
    return {'word': word, 'value': value, 'short': short, 'raw': value,
            'band': None, 'tone': tone, 'color': color}


def delta(word, direction, arrow, value, tone, base=True):
    return {'word': word, 'direction': direction, 'arrow': arrow, 'value': value,
            'magnitude': abs(value) if value is not None else None,
            'hasBaseline': base, 'tone': tone}


TIMELINE = []
for i, (d, v) in enumerate(zip(DAYS, VOL)):
    neg = round(v * (0.30 + 0.05 * math.sin(i / 1.3)))
    pos = round(v * (0.34 - 0.04 * math.sin(i / 1.9)))
    TIMELINE.append({
        'date': d[5:], 'fullDate': d, 'totalMentions': v,
        'positivo': pos, 'neutral': v - pos - neg, 'negativo': neg,
        # nss null en un día: es el hueco de serie que el contrato isGap() debe
        # respetar en vez de dibujar una línea recta que inventa el dato.
        'nss': None if i == 2 else round(-22 + math.sin(i / 1.7) * 14),
    })

TOPICS_RAW = [
    ('Energía e infraestructura', 'energia', 253, 17, 34, 49, 12),
    ('Permisos y trámites', 'permisos', 213, 15, 35, 50, -3),
    ('Empleo y adiestramiento', 'empleo', 173, 34, 41, 25, 18),
    ('Transparencia y fondos', 'transparencia', 160, 11, 41, 48, 0),
    ('Incentivos contributivos', 'incentivos', 133, 37, 44, 19, -7),
    ('PyMEs y comercio local', 'pymes', 120, 43, 41, 16, 4),
    ('Turismo', 'turismo', 106, 58, 33, 9, 9),
    ('Agricultura', 'agricultura', 93, 43, 44, 13, -2),
    ('Atención ciudadana', 'atencion', 80, 28, 41, 31, 18),
]
TOPICS = [{'name': n, 'slug': s, 'count': c, 'positivePct': p,
           'neutralPct': nu, 'negativePct': ng, 'delta': dl,
           # 'mixed' cuando ningún lado domina: el enum crudo en inglés que la
           # auditoría encontró filtrándose a la interfaz.
           'dominantSentiment': ('positivo' if p - ng > 8 else
                                 'negativo' if ng - p > 8 else 'mixed'),
           'alsoCount': max(0, (c // 40) - 1)}
          for n, s, c, p, nu, ng, dl in TOPICS_RAW]

# NSS en la escala CANÓNICA −100..100 (#92 quitó el /10 del cálculo). Incluye un
# 0 exacto y valores dentro de la banda neutra ±20, que es donde se ve si el
# color de la banda es neutro o de severidad.
MUNI = [('San Juan', 'Norte', 346, -31, 18.4655, -66.1057),
        ('Bayamón', 'Norte', 146, -24, 18.3985, -66.1614),
        ('Carolina', 'Norte', 120, -18, 18.3809, -65.9574),
        ('Ponce', 'Sur', 106, 0, 18.0111, -66.6141),
        ('Caguas', 'Este', 93, -12, 18.2341, -66.0485),
        ('Mayagüez', 'Oeste', 80, 0, 18.2013, -67.1397),
        ('Arecibo', 'Norte', 67, 14, 18.4725, -66.7156),
        ('Guaynabo', 'Norte', 67, -9, 18.3574, -66.1110)]

EMO = [('ira', 453), ('preocupación', 320), ('esperanza', 186),
       ('alegría', 160), ('sorpresa', 133), ('tristeza', 80)]

SOURCES = [('X / Twitter', 'x', 412), ('Noticias', 'news', 338),
           ('Facebook', 'facebook', 291), ('Instagram', 'instagram', 154),
           ('YouTube', 'youtube', 88), ('TikTok', 'tiktok', 48)]

MENTIONS = []
for i in range(24):
    n, reg, c, nss, la, lo = MUNI[i % len(MUNI)]
    MENTIONS.append({
        'id': f'm{i+1}',
        'title': ['DDEC anuncia inversión de $340 millones en manufactura',
                  'Empresarios denuncian demoras de hasta 8 meses en permisos',
                  'Tercer apagón general del mes deja a 1.2 millones sin luz',
                  'Puerto Rico rompe récord de visitantes: 6.4 millones',
                  'Feria de empleo en Ponce conecta a 1,400 solicitantes'][i % 5],
        'author': f'@medio_{i % 7}', 'source': SOURCES[i % len(SOURCES)][1],
        'domain': ['elnuevodia.com', 'primerahora.com', 'x.com'][i % 3],
        'publishedAt': f'2026-08-0{1 + (i % 3)}T{9 + (i % 12):02d}:{(i * 7) % 60:02d}:00Z',
        'sentiment': ['negativo', 'neutral', 'positivo'][i % 3],
        # engagement en 0 en algunas: distinguir "cero medido" de "sin dato"
        'engagement': 0 if i % 6 == 0 else (i + 1) * 137,
        'municipality': n, 'region': reg,
    })

def by(items, key):
    return [{key: k, 'total': t, 'positive': round(t * p / 100),
             'neutral': round(t * nu / 100), 'negative': round(t * ng / 100),
             'positivePct': p, 'neutralPct': nu, 'negativePct': ng}
            for k, t, p, nu, ng in items]

REMOTE = {
    'AGENCIES_FULL': [
        {'key': 'ddecpr', 'name': 'DDEC', 'slug': 'ddecpr'},
        {'key': 'aaa', 'name': 'AAA', 'slug': 'aaa'},
        {'key': 'gobernadora', 'name': 'Gobernadora', 'slug': 'gobernadora'},
        {'key': 'sgpr', 'name': 'SGPR', 'slug': 'sgpr'},
        {'key': '__all__', 'name': 'Todas las agencias', 'slug': '__all__'}],
    'USER_AGENCY_SLUG': 'ddecpr',
    'TIMELINE': TIMELINE,
    'CURRENT_METRICS': {
        'nss': -22, 'nssDelta': -4, 'nss7d': -19, 'nss30d': -11,
        'brandHealthIndex': 41, 'brandHealthDelta': 2.6,
        'crisisRiskScore': 0.18, 'crisisDelta': 0.03,
        'totalMentions': sum(VOL), 'totalMentionsDelta': 12.4,
        'totalReach': 1284000, 'engagementRate': 3.4, 'engagementDelta': -1.2,
        'amplificationRate': 1.8, 'amplificationDelta': 0.4,
        'reputationMomentum': -0.6, 'engagementVelocity': 1.3,
        'volumeAnomalyZscore': 0.9,
        # null a propósito: la métrica que el producto no siempre calcula
        'polarizationIndex': None,
        'positiveCount': 289, 'neutralCount': 305, 'negativeCount': 264,
        'highPertinenceCount': 148, 'totalEngagement': 36581,
        'display': {
            'nss': disp('Negativo leve', -22, '-22', 'neg', 'var(--neg)'),
            'brandHealth': disp('Débil', 41, '41/100', 'warn', 'var(--warn)'),
            'crisis': disp('Normal', 0.18, '0.18', 'pos', 'var(--pos)'),
            'polarization': disp('—', None, '—', 'neutral', 'var(--text-3)'),
            'engagementRate': disp('Moderada', 3.4, '3.4%', 'warn', 'var(--warn)'),
            'amplificationRate': disp('Baja', 1.8, '1.8x', 'neutral', 'var(--text-2)'),
            'velocity': disp('Acelerada', 1.3, '1.3x', 'warn', 'var(--warn)'),
        },
        'deltaDisplay': {
            'nss': delta('baja', 'down', '▼', -4, 'neg'),
            'brandHealth': delta('sube', 'up', '▲', 2.6, 'pos'),
            'crisis': delta('sube', 'up', '▲', 0.03, 'neg'),
            'engagementRate': delta('baja', 'down', '▼', -1.2, 'neg'),
            'totalMentions': delta('sube', 'up', '▲', 12.4, 'neutral'),
            # sin base: el caso que debe rendirse como "— sin base", no como 0
            'polarization': delta('sin base', 'none', '—', None, 'neutral', False),
        },
    },
    'SENTIMENT_BREAKDOWN': [
        {'name': 'positivo', 'value': 289, 'label': 'Positivo'},
        {'name': 'neutral', 'value': 305, 'label': 'Neutral'},
        {'name': 'negativo', 'value': 264, 'label': 'Negativo'}],
    'TOP_SOURCES': [{'source': n, 'key': k, 'count': c} for n, k, c in SOURCES],
    'TOPICS': TOPICS,
    'MUNICIPALITIES': [{'name': n, 'region': r, 'count': c, 'nss': nss,
                        'lat': la, 'lon': lo} for n, r, c, nss, la, lo in MUNI],
    'EMOTIONS': [{'emotion': e, 'count': c} for e, c in EMO],
    'MENTIONS': MENTIONS,
    'ALERTS': [
        {'id': 'a1', 'name': 'Pico de menciones negativas · Energía',
         'priority': 'critical', 'active': True, 'triggered': 0,
         'lastFired': '2026-08-03T14:20:00Z', 'channels': ['email']},
        {'id': 'a2', 'name': 'Crisis: NSS bajo umbral', 'priority': 'high',
         'active': True, 'triggered': 0, 'lastFired': '2026-08-02T09:00:00Z',
         'channels': ['email']},
        {'id': 'a3', 'name': 'Volumen anómalo', 'priority': 'medium',
         'active': True, 'triggered': 0, 'lastFired': None, 'channels': ['email']},
        {'id': 'a4', 'name': 'Sentimiento negativo sostenido', 'priority': 'low',
         'active': False, 'triggered': 0, 'lastFired': None, 'channels': []}],
    'ALERT_FEED': [
        {'id': f'f{i}', 'ruleName': ['Pico de menciones negativas · Energía',
                                     'Crisis: NSS bajo umbral', 'Volumen anómalo'][i % 3],
         'severity': ['critical', 'high', 'medium'][i % 3],
         'firedAt': f'2026-08-0{1 + (i % 3)}T{10 + i:02d}:00:00Z',
         'mentionCount': [4, 3, 24, 7][i % 4]} for i in range(8)],
    'COMPARISON': [
        {'label': 'Esta semana', 'total': sum(VOL), 'nss': -22},
        {'label': 'Semana anterior', 'total': 585, 'nss': -18}],
    'SENTIMENT_BY_SOURCE': by([(n, c, 30, 38, 32) for n, k, c in SOURCES], 'source'),
    'SENTIMENT_BY_TOPIC': by([(t['name'], t['count'], t['positivePct'],
                               t['neutralPct'], t['negativePct']) for t in TOPICS], 'topic'),
    'SENTIMENT_BY_REGION': by([(r, c, 31, 37, 32) for _, r, c, _, _, _ in MUNI[:5]], 'region'),
    'SENTIMENT_BY_SUBTOPIC': by([('Apagones', 121, 9, 28, 63),
                                 ('Tarifas', 74, 12, 33, 55),
                                 ('Generación', 58, 21, 44, 35)], 'subtopic'),
    'SUBTOPICS': {t['slug']: [
        {'name': f'Subtópico {j+1} de {t["name"][:14]}', 'slug': f'{t["slug"]}-{j+1}',
         'volume': max(3, t['count'] // (3 + j)), 'sentiment':
             ['negativo', 'neutral', 'positivo'][j % 3]} for j in range(3)]
        for t in TOPICS},
    'TOPIC_CALENDAR': [
        {'date': d[5:], 'fullDate': d, 'topicName': TOPICS[i % len(TOPICS)]['name'],
         'topicSlug': TOPICS[i % len(TOPICS)]['slug'], 'volume': v,
         'sentiment': TOPICS[i % len(TOPICS)]['dominantSentiment']}
        for i, (d, v) in enumerate(zip(DAYS, VOL))],
}

# /api/eco-geo lo consulta la pantalla de Geografía cada vez que cambian los
# filtros; D.MUNICIPALITIES del boot es sólo el estado inicial. Sin este fixture
# el mapa sale sin marcadores y no se puede verificar ni el radio ni el color.
with open(os.path.join(FIX, 'eco-geo.json'), 'w', encoding='utf-8') as f:
    json.dump({'municipalities': REMOTE['MUNICIPALITIES']}, f, ensure_ascii=False, indent=1)

with open(os.path.join(FIX, 'eco-data-remote.json'), 'w', encoding='utf-8') as f:
    json.dump(REMOTE, f, ensure_ascii=False, indent=1)
print(f'eco-data-remote.json: {len(REMOTE)} claves, {sum(VOL)} menciones')
