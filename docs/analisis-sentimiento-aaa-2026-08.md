# Análisis: AAA sin positivos del NLP — mecanismo, evidencia y propuesta medible

**Fecha:** 2026-08-11 · **Detonante:** la suite de datos (`npm run contract:live`) mostró `nlp_pos=0` para AAA con `bw_pos≈20/mes` · **Estado:** propuesta evaluada offline, **pendiente de decisión editorial** — nada tocado en producción.

---

## 1. El síntoma

| Mes 2026 | AAA pos/total | DDEC pos/total | Gobernadora pos/total |
|---|---|---|---|
| Febrero | 71/674 (10.5%) | 564/865 (65.2%) | 104/3,665 (2.8%) |
| Marzo | 131/429 (30.5%) | 526/907 (58.0%) | 95/3,930 (2.4%) |
| Abril | 14/167 (8.4%) | 378/2,454 (15.4%) | 98/2,819 (3.5%) |
| Mayo | 2/347 (0.6%) | 112/1,610 (7.0%) | 118/4,165 (2.8%) |
| Junio | **0/1,267 (0.0%)** | 66/2,230 (3.0%) | 101/2,308 (4.4%) |
| Julio | **0/1,019 (0.0%)** | 25/796 (3.1%) | 66/3,032 (2.2%) |
| Agosto | **0/928 (0.0%)** | 4/148 (2.7%) | 55/1,849 (3.0%) |

Cero absoluto sobre 3,214 menciones en 3 meses, mientras Brandwatch ve 17–29 positivos/mes.

## 2. El mecanismo (no es un bug — es una sobrecorrección deliberada)

El commit `32f6aa3` (**19-abr-2026**, "data-quality: … calibrate NLP …") añadió al prompt del processor las REGLAS DE SENTIMIENTO actuales, para corregir un problema real y documentado: *"Claude was too positive — it rated 5,600 'bw=neutral' news items as 'positivo'"* (la inflación del 65% de DDEC). Las reglas exigen:

> - "positivo" **EXCLUSIVAMENTE** cuando el autor/medio expresa evaluación explícitamente favorable… Señales: "felicita", "excelente", "gracias a", "aplauden"…
> - **NO marques positivo solo porque se resuelva un problema o se inaugure algo.**
> - Si el Sentimiento Brandwatch dice "neutral", usa "neutral" salvo señales inequívocas.

**Efecto por agencia** (coherente con la tabla): DDEC se desinfló de 65% → 3% (objetivo cumplido: sus "anuncios de inversión" son futuros, no logros). Gobernadora quedó intacta (~3%: la cobertura política sí trae elogio explícito). **AAA colapsó a 0.0%**: la cobertura positiva de una agencia de servicio es del tipo *"AAA completa reparación de emergencia"* — un logro consumado SIN vocabulario de elogio, que la regla manda a neutral. El razonamiento del propio modelo lo confirma: *"El texto describe el hecho sin evaluación"*.

Nota adicional: el bloque de "REGLAS DE ROUTING CROSS-TOPIC" del prompt es DDEC-específico (Secretario, FITUR, Ley 60) y se envía a TODAS las agencias — contaminación menor, se propone limpiarlo en el mismo cambio.

## 3. Evidencia con muestras (jun–ago, bw=positivo)

| Mención | NLP actual | Lectura editorial |
|---|---|---|
| "AAA **completa** reparación de emergencia en línea que alimenta el tanque de 4M (Ponce)" | neutral | **positivo** — logro operativo consumado |
| "Juncos… **ve avances positivos** tras reunión con gobernadora y la AAA" | neutral | **positivo** — elogio explícito de un tercero (miss incluso bajo la regla actual) |
| "Renuncia presidente de la Junta de la AAA tras controversia" | negativo | negativo ✓ (Brandwatch se equivoca: lo marcaba positivo) |
| "Proponen plan de 20 años para rehabilitar infraestructura" | neutral | neutral ✓ (propuesta, no logro) |
| "AAA anuncia reparación de tubería **para mañana**" | neutral | neutral ✓ (anuncio futuro) |

Y lo que ANTES pasaba como positivo (feb–mar): "culmina reparación dos días antes de lo proyectado", "prórroga de pago (alivio)", "suspende cortes durante la emergencia", "culmina dragado", "acuerdo AAA-UIA deja sin efecto el paro" — todos logros/alivios consumados, razonables editorialmente. (Dos borderline que la rúbrica nueva deja en neutral: "continuación de construcción" y "se comprometen a sustituir tuberías" — compromisos, no logros.)

## 4. Golden set y rúbrica propuesta

`scripts/eval/aaa-sentiment-golden.json` — **37 menciones reales etiquetadas** (14 bw-positivo jun-ago · 12 aleatorias jun-ago · 8 nlp-positivo pre-regla · 3 guardas DDEC), con la rúbrica:

> **positivo** = logro consumado que beneficia al ciudadano, medida de alivio concreta, o elogio explícito · **neutral** = informativo / anuncio futuro / propuesta / compromiso · **negativo** = falla, queja, crisis, denuncia, renuncia, racionamiento.

Distribución de etiquetas: 8 positivo · 18 neutral · 11 negativo. *(Las etiquetas son mi juicio editorial aplicando la rúbrica — revisar/ajustar las que no compartas: son la vara del experimento.)*

## 5. Evaluación offline (mismo modelo que prod: Opus 4.6 vía Bedrock)

`scripts/eval-sentiment-aaa.ts` corre el golden con las reglas ACTUALES verbatim vs las PROPUESTAS:

| Métrica | ACTUAL | **PROPUESTA** |
|---|---|---|
| Exactitud global | 23/37 (62%) | **33/37 (89%)** |
| Recall de positivos | **0/8** ← reproduce el cero de prod | **7/8** |
| Precisión de positivos | 0% | **88%** |
| Guarda DDEC (anuncios→positivo) | 1 violación* | 1 violación* (sin empeorar) |

\* La misma en ambas: el post autopromocional de Collins en Instagram ("anunciamos la expansión… 525 empleos") — celebratorio en primera persona; el modelo lo marca positivo bajo cualquier variante. No es regresión de la propuesta.

Los 4 desacuerdos restantes de la PROPUESTA son juicios finos (avería→neutral vs negativo, "inicia racionamiento" informativo→neutral, el caso Juncos que ni la regla actual captura).

## 6. La propuesta exacta (diff del prompt)

Mantener las 5 reglas actuales **y añadir** al bloque de sentimiento del processor (`infra/lambda/processor/index.ts`):

```
- "positivo" TAMBIÉN cuando la mención reporta un LOGRO OPERATIVO CONSUMADO o una
  MEDIDA DE ALIVIO CONCRETA de ${agency.name} hacia la ciudadanía, aunque no haya
  elogio explícito: reparación CULMINADA, servicio RESTABLECIDO ("culmina",
  "completa", "restablece" + el trabajo terminado), acuerdo que resuelve un
  conflicto (p. ej. deja sin efecto un paro), alivio directo al abonado
  (suspensión de cortes, prórrogas de pago, créditos otorgados). En cobertura de
  agencias de servicio público, el hecho favorable CONSUMADO es en sí la evaluación.
- SIGUE siendo "neutral": anuncios de trabajos FUTUROS, propuestas, planes,
  compromisos sin ejecutar, avances PARCIALES con clientes aún afectados,
  inauguraciones protocolares y anuncios de inversión o expansión sin resultado
  material entregado. La regla "no marques positivo por anuncios" SE MANTIENE.
- Prioridad del hint: si el texto reporta un logro consumado o un alivio concreto,
  márcalo "positivo" aunque el Sentimiento Brandwatch diga "neutral".
```

Adicional (mismo cambio): condicionar el bloque de ROUTING CROSS-TOPIC a `agency.slug === 'ddecpr'`.

## 7. Impacto simulado en el NSS de AAA

NSS = (pos − neg) / total. Con positivos recuperados al ritmo p:

| Mes | NSS actual | p=2% | p=5% | p=8% |
|---|---|---|---|---|
| Junio | −47.0 | −45.0 | −42.0 | −39.0 |
| Julio | −29.7 | −27.7 | −24.7 | −21.7 |
| Agosto | −45.1 | −43.1 | −40.1 | −37.1 |

**Lectura honesta:** el fix mueve el NSS +2 a +8 puntos — NO cambia la historia (la crisis del agua domina), pero restaura la fidelidad de la señal: hoy el termómetro es incapaz de registrar una recuperación aunque ocurra, y el bloque "positivo" de correos/dashboard lleva 3 meses vacío por construcción. En meses normales (feb: 10.5%) el efecto sería mayor.

## 8. Plan de rollout medible (si apruebas)

1. **Aprobar/ajustar la rúbrica y las 37 etiquetas** del golden (son la vara).
2. Aplicar el diff del §6 al processor + redeploy (esbuild, patrón documentado).
3. **Criterio de aceptación** (re-correr `tsx scripts/eval-sentiment-aaa.ts` post-deploy): recall de positivos ≥ 6/8, precisión ≥ 80%, y cero violaciones NUEVAS de la guarda DDEC vs la línea base.
4. **Vigilancia 2 semanas** con `npm run contract:live`: el nuevo WARN "clasificador emite positivos" debe apagarse para AAA; los shares mensuales deben quedar en AAA ≈ 2–6%, DDEC ≤ 5%, Gobernadora 2–5% (estables). Si DDEC re-inflara (>8%), rollback del bullet 1 y refinamos la guarda.
5. **Opcional (histórico):** re-clasificación dirigida de las ~3,200 menciones AAA jun–ago (nueva acción `reprocess-sentiment` con filtro agencia+rango, mismo patrón que `reprocess-unclassified`). Sin esto, el fix aplica solo hacia adelante y el histórico queda con el sesgo documentado aquí.

**Qué NO cambia:** fórmulas de métricas (NSS/BHI/crisis se recalculan solos de los conteos), universos, ventanas. Solo la rúbrica del clasificador.
