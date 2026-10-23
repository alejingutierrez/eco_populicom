# QA de refresco y consistencia data ↔ gráficos (23-oct-2026)

Disparador: «Emociones, 12 semanas» (Sentimiento) «no actualiza en qué día
estamos y muestra cosas que no son». Se revisaron todas las pantallas del SPA
(Overview, Scorecard, Menciones, Búsqueda, Sentimiento, Tópicos, Geografía,
Narrativas, Alertas y las vistas ejecutivas) con sus endpoints, contra la base
de producción, con prioridad DF (ventana 7D = 16→22 oct).

Método: el código REAL de cada endpoint corrido contra prod vía el lambda
`eco-migration` (adaptador `PgClientLike`), SQL independiente para comparar,
logs de `/ecs/eco-web` y `/aws/lambda/eco-metrics-calculator`, y el SPA
compilado en Chrome headless con datos reales de DF.

## Lo que SÍ cuadraba (DF 7D)

Total 1,109 (7 pos / 403 neu / 699 neg), NSS −62.4, crisis 30.7 %, serie
diaria 231·93·55·81·199·268·182, tópicos (Σ = 1,109), drill-downs de día,
fuente, hora y tópico, la cascada del NSS y cada celda de «Emociones, 12
semanas» contra su modal. La mezcla Bunker + Brandwatch no produce saltos ni
duplicados en el corte del 22-oct.

## Hallazgos y estado

### Datos que se veían mal

| # | Qué | Evidencia | Estado |
|---|---|---|---|
| 1 | El recálculo diario de snapshots (`eco-metrics-calculator`, 09:00 UTC) moría por timeout (120 s, 3 intentos) recorriendo todo el historial; DF, última del bucle, quedó sin recalcular desde el 4-may | 22-oct: snapshot 128 menciones / crisis 0.209; real 182 / 0.247 | Arreglado (45 días + ayer cada 5 min) y DF recalculado a mano 4-may→23-oct |
| 2 | Modal de un tópico/subtópico con slug repetido entre agencias → 500 → «0 menciones» | `criticas-controversias` y «Pugna Fortaleza vs Senado» en ddecpr y gobernadora | Arreglado |
| 3 | Textos IA cacheados de ventanas cerradas nunca se regeneraban | DF 15→21 oct decía 720 menciones (hay 1,037); 17 de 19 desfasados; resumen ejecutivo sin TTL | Arreglado (se regeneran si llegaron menciones después) |
| 4 | Vistas ejecutivas: SGPR (sin datos desde 1-sep) y AAA (en pausa) con píldora verde NORMAL; olas del Radar con delta fijo en 0 | — | Arreglado |
| 5 | Página Menciones: análisis en ventana rolante | 16-oct de DF con 20 de 231 | Arreglado |
| 6 | Nube de términos: fuente con coincidencia exacta (Facebook 1 vs 369, Instagram 0), ignoraba from/to, servía otra agencia si el usuario no tenía ninguna | — | Arreglado |
| 7 | Sentimiento por subtópico / por región no cuadraban con su modal | Imagen y Credibilidad 100 → 418; Metro 223 → 195 | Arreglado |
| 8 | Calendario de tópicos contaba tópicos secundarios y corría la semana al faltar un día | 21-oct «Gestión Secretaria 226» vs ADSEF 130 por principal | Arreglado |
| 9 | Narrativas viejas (efecto de los backfills) en «Naciendo» | 11 de 28 sin mención en la semana | Arreglado |
| 10 | «Lo usual» del Scorecard contaba semanas antes de que DF existiera | p25 = 0 | Arreglado (desde inicio de cobertura) |
| 11 | Días sin snapshot pintados como NSS 0 / BHI 1.0 | ddecpr 12 y 20-sep, df 19-sep | Arreglado (hueco) |
| 12 | Descripción de tópico: el prompt recibía conteos multi-tópico | gestion-secretaria 612 vs 183 | Arreglado |

### Refresco

| # | Qué | Estado |
|---|---|---|
| 13 | Pestaña abierta tras la medianoche de PR: cards en la ventana de ayer, header y pantallas perezosas en la de hoy (dos ventanas en una pantalla) | Arreglado: recarga (o aviso si se está usando); también si otra pestaña cambia agencia/periodo |
| 14 | Header, drill-downs, Geografía y la descripción de tópico recalculaban la ventana con el reloj del navegador | Arreglado: usan D.PERIOD |
| 15 | Caché del modal «Detalles» en sessionStorage sin la ventana en la clave | Arreglado |
| 16 | «Actualizando…» del Overview se quedaba fijo | Arreglado |
| 17 | Cada consulta de polling (2 s) lanzaba otra generación Opus | Arreglado (dedupe 3 min) |
| 18 | Selector de rango con tope = día UTC (de 8 PM a medianoche permitía «mañana») | Arreglado (tope = ayer PR) |

### Cosméticos arreglados

Columnas de «Emociones, 12 semanas» y de Geografía rotuladas con su último
día (el reporte del usuario); semanas resaltadas según la ventana; barras
semanales de Sentimiento ancladas al último día; cascada del NSS que suma
exactamente el cambio; estado de error visible en emociones; Evolución del
tópico con días en 0; `<strong>` literal en descripciones; día de PR en
«Activaciones por día» e historial de crisis completo; cinta de crisis sin
días de muestra insuficiente.

## Pendiente (no se tocó)

- **DF depende de Bunker para el 63 % del volumen.** El último exporte cubre
  hasta el 22-oct. Brandwatch no trae X ni TikTok y trae YouTube sin
  interacciones. Si no llegan más exportes, las ventanas que incluyan el 23-oct
  en adelante mostrarán una caída de ~60 % que es cambio de fuente, no de
  conversación. Decisión de producto: seguir importando o anotar el corte.
- Nube de términos: cuenta con stemming e incluye el resumen IA; al hacer clic
  la lista filtra por texto literal («niños» 89 → 21). Y `q` con varias
  palabras se compara como frase.
- Fuentes del Scorecard: top 6 sin fila «Otras» (DF suma 1,096 de 1,109).
- Etiquetas relativas («hace 3 min») congeladas desde la carga.
- Brandwatch backfilleado de antes de la ventana de 21 días nunca se agrupa en
  narrativas (lectura, no bug).
- Tabla de reglas de Alertas con severidad/conteo/último disparo fijos.
