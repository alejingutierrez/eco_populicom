# Boolean de Brandwatch de DF (query 2004156405) como estructura de datos.
#
# Genera el texto del boolean (booleanQuery()) y lo EMULA sobre textos
# (match(raw) → términos que disparan), para medir el recall contra un corpus
# conocido antes de tocar la query en Brandwatch. Así se diseñó la v1 el
# 22-oct-2026 contra las 4,455 menciones de Bunker: 99.8% de las «alta», 96%
# de las «media» y solo 61% de las «baja» (el ruido de Bunker era el verbo
# «acuden», que su query confundía con ACUDEN).
#
# La emulación es aproximada (NEAR por distancia en palabras ±3, sin
# stemming): sirve para comparar versiones, no para predecir el volumen de BW.
import re,unicodedata
def norm(s): return unicodedata.normalize('NFKD',s or '').encode('ascii','ignore').decode().lower()
def P(*xs): return ('OR',list(xs))
def NEAR(a,b,n): return ('NEAR',a,b,n)
T1 = [  # identidad inequívoca, matchean solos
 '"Departamento de la Familia"','"Depto de la Familia"','"Dpto de la Familia"','"Dept de la Familia"',
 '"Secretaria de la Familia"','"Secretario de la Familia"','"Secretaria del Departamento de la Familia"',
 '"Suzanne Roig"','"Susan Roig"','"Roig Fuertes"','"Blanca Medina Díaz"','"Departamento de Familia"','"Depto Familia"','"Dpto Familia"','#ACUDEN','"acuden.pr.gov"','"adsef.pr.gov"','ADSEF','ADFAN',
 '"Administración de Desarrollo Socioeconómico"','"Administración de Familias y Niños"',
 '"Administración para el Cuidado y Desarrollo Integral de la Niñez"','"Administración para el Sustento de Menores"',
 '"Tarjeta de la Familia"','"Programa de Asistencia Nutricional"',
 '"Puerto Rico Department of the Family"','"Puerto Rico Department of Family"','"Puerto Rico Family Department"',
 'FICPRO','"Federación de Instituciones de Cuido Prolongado"','"cuido prolongado"',
 '@SomosFamiliaPR','SomosFamiliaPR','#DepartamentoDeLaFamilia','#SuzanneRoig','"familia.pr.gov"','@adseffamilia',
 '"749-1333"','"981-8333"',
]
PR = P('"Puerto Rico"','boricua*','puertorrique*','ADSEF','"Departamento de la Familia"','Familia')
T2 = [ # siglas/nombres ambiguos con contexto
 NEAR('ACUDEN', P('"Head Start"','cuido','niñez','Familia','subsidio*','administrador*','"centros de cuido"','"centros de cuidado"','"cuidado infantil"','"Vega Ojeda"','"niñez temprana"','Roig'),8),
 NEAR('Roig', P('secretaria','Familia','ADSEF','TANF','"Rivera Schatz"','ASSMCA','Coccoloba','NOLA','"Star Academy"','"LAP Consulting"'),8),
 NEAR('"LAP Consulting"', P('Familia','Roig','ASSMCA','Senado','TANF','contrato*'),15),
 NEAR('"cuidado prolongado"', P('hogar','hogares','Familia','licencia*','clandestino*'),6),
 NEAR(P('"hogar de cuido"','"hogares de cuido"'), P('licencia*','clandestino*','cierre*','clausur*','maltrato','fiscaliz*','envejecientes','"adultos mayores"'),10),
 NEAR('ASUME', P('"pensión alimentaria"','"pensiones alimentarias"','"sustento de menores"','administrador*','"child support"'),6),
 NEAR('TANF', P('"Puerto Rico"','ADSEF','Familia','boricua*','Roig'),12),
 NEAR('"Head Start"', P('"Puerto Rico"','ACUDEN','boricua*'),12),
 NEAR('"Star Academy"', P('Familia','ADSEF','Senado','"Puerto Rico"','"Rivera Schatz"','Roig','NOLA','contrato*','TANF','millones','audiencia'),15),
 NEAR('"NOLA Education"', P('Familia','ADSEF','Senado','"Puerto Rico"','"Rivera Schatz"','Roig','contrato*','"Star Academy"'),20),
 NEAR('Coccoloba', P('Familia','ADSEF','Senado','"Rivera Schatz"','Roig','contrato*','NOLA','propuesta*'),15),
 NEAR('"Blanca Medina"', P('ADSEF','Familia','administradora','destitu*','Roig','Senado','contrato*','denuncia*','testific*','"Star Academy"','TANF','Gobernadora'),15),
 NEAR('"Department of Family Affairs"', P('"Puerto Rico"','PR'),8),
 NEAR('"Department of the Family"', P('"Puerto Rico"'),8),
 NEAR('"beneficiarios del PAN"', P('Familia','"Puerto Rico"','ADSEF','pago*','tarjeta'),20),
 # "Familia" como nombre corto de la agencia (custodia de Familia, Secretaria de Familia…)
 '"custodia de Familia"','"Secretaria de Familia"','"Secretario de Familia"','"titular de Familia"',
 NEAR('Familia', P('"hogar de cuido"','"hogares de cuido"','"hogar de crianza"','"hogares de crianza"','"maltrato de menores"','"maltrato institucional"','"Línea de Orientación"','"trabajadora social"','"trabajadoras sociales"','"trabajadores sociales"'),6),
]
NOTS = ['"Instituto de la Familia"']  # placeholder
def bw(x):
  if isinstance(x,str): return x
  if x[0]=='OR': return '('+' OR '.join(bw(y) for y in x[1])+')'
  if x[0]=='NEAR': return f'({bw(x[1])} NEAR/{x[3]} {bw(x[2])})'
def booleanQuery():
  parts=[bw(t) for t in T1]+[bw(t) for t in T2]
  return '(\n'+' OR\n'.join(parts)+'\n)'
# ---- emulación ----
def term_rx(t):
  t=norm(t)
  if t.startswith('"'):
    w=t.strip('"'); w=re.sub(r'[^a-z0-9 ]',' ',w).split()
    return r'\b'+r'\W+'.join(re.escape(x) for x in w)+r'\b'
  if t.startswith('#'): return r'#'+re.escape(t[1:])+r'\b'
  t=t.lstrip('@')
  if t.endswith('*'): return r'\b'+re.escape(t[:-1])+r'\w*'
  return r'\b'+re.escape(t)+r'\b'
def positions(x,toks_text):
  # devuelve set de posiciones de palabra donde empieza un match
  text,offs=toks_text
  if isinstance(x,str):
    out=set()
    for m in re.finditer(term_rx(x),text):
      out.add(word_index(offs,m.start()))
    return out
  if x[0]=='OR':
    s=set()
    for y in x[1]: s|=positions(y,toks_text)
    return s
  if x[0]=='NEAR':
    a=positions(x[1],toks_text); b=positions(x[2],toks_text); n=x[3]
    return {i for i in a if any(abs(i-j)<=n+3 for j in b)}  # +3 tolera frases multi-palabra
import bisect
def word_index(offs,c): return bisect.bisect_right(offs,c)-1
def prep(raw):
  t=norm(raw); t=re.sub(r'(?<=[a-z])\.(?=\s)',' ',t)
  offs=[m.start() for m in re.finditer(r'\S+',t)]
  return (t,offs)
def match(raw):
  tt=prep(raw); hits=[]
  for t in T1+T2:
    if positions(t,tt): hits.append(bw(t) if not isinstance(t,str) else t)
  return hits
