// ============================================================
// ECO Platform — Topic & Subtopic Taxonomy
// Derived from analysis of ~200 real Brandwatch mentions for AAA
// ============================================================

export interface TopicDef {
  slug: string;
  name: string;
  description: string;
  displayOrder: number;
  subtopics: SubtopicDef[];
}

export interface SubtopicDef {
  slug: string;
  name: string;
  description: string;
  displayOrder: number;
}

export const AAA_TOPICS: TopicDef[] = [
  {
    slug: 'averias-interrupciones',
    name: 'Averías / Interrupciones',
    description: 'Fallas técnicas que interrumpen el servicio de agua',
    displayOrder: 1,
    subtopics: [
      { slug: 'bombeo-represas', name: 'Bombeo / Represas', description: 'Fallas en bombas, represas (Carraízo, etc.)', displayOrder: 1 },
      { slug: 'plantas-filtracion', name: 'Plantas de Filtración', description: 'Plantas fuera de servicio o con capacidad reducida', displayOrder: 2 },
      { slug: 'tuberias-fugas', name: 'Tuberías / Fugas', description: 'Roturas de tuberías, fugas en la red', displayOrder: 3 },
      { slug: 'apagones-infraestructura', name: 'Apagones en Infraestructura', description: 'Fallas eléctricas que afectan operación de plantas/bombas', displayOrder: 4 },
    ],
  },
  {
    slug: 'calidad-agua',
    name: 'Calidad del Agua',
    description: 'Problemas relacionados con la calidad del agua potable',
    displayOrder: 2,
    subtopics: [
      { slug: 'turbidez', name: 'Turbidez', description: 'Alta turbidez en fuentes de agua cruda', displayOrder: 1 },
      { slug: 'contaminacion', name: 'Contaminación', description: 'Contaminación química o biológica', displayOrder: 2 },
      { slug: 'presion-baja', name: 'Presión Baja', description: 'Baja presión de agua en sectores', displayOrder: 3 },
    ],
  },
  {
    slug: 'conflictos-inter-agencia',
    name: 'Conflictos Inter-Agencia',
    description: 'Disputas entre AAA y otras entidades gubernamentales',
    displayOrder: 3,
    subtopics: [
      { slug: 'aaa-vs-luma', name: 'AAA vs LUMA', description: 'Conflictos con LUMA Energy por fallas eléctricas', displayOrder: 1 },
      { slug: 'aaa-vs-municipios', name: 'AAA vs Municipios', description: 'Disputas con alcaldes y gobiernos municipales', displayOrder: 2 },
      { slug: 'aaa-vs-legislatura', name: 'AAA vs Legislatura', description: 'Cuestionamientos desde Cámara o Senado', displayOrder: 3 },
    ],
  },
  {
    slug: 'infraestructura',
    name: 'Infraestructura',
    description: 'Inversiones, obras y mejoras a la infraestructura de agua',
    displayOrder: 4,
    subtopics: [
      { slug: 'obras-nuevas', name: 'Obras Nuevas', description: 'Construcción de nueva infraestructura', displayOrder: 1 },
      { slug: 'renovacion', name: 'Renovación', description: 'Renovación de tuberías, plantas, equipos existentes', displayOrder: 2 },
      { slug: 'fondos-federales', name: 'Fondos FEMA / Federales', description: 'Asignaciones de fondos FEMA u otros federales', displayOrder: 3 },
      { slug: 'inversiones', name: 'Inversiones', description: 'Inversiones generales en infraestructura', displayOrder: 4 },
    ],
  },
  {
    slug: 'servicio-cliente',
    name: 'Servicio al Cliente',
    description: 'Experiencia del cliente con los servicios de la agencia',
    displayOrder: 5,
    subtopics: [
      { slug: 'facturacion-depositos', name: 'Facturación / Depósitos', description: 'Tarifas, depósitos de conexión, pagos', displayOrder: 1 },
      { slug: 'quejas', name: 'Quejas', description: 'Quejas generales del público sobre el servicio', displayOrder: 2 },
      { slug: 'comunicacion-deficiente', name: 'Comunicación Deficiente', description: 'Falta de información oportuna a abonados', displayOrder: 3 },
    ],
  },
  {
    slug: 'crisis-emergencias',
    name: 'Crisis / Emergencias',
    description: 'Situaciones de emergencia que afectan el servicio',
    displayOrder: 6,
    subtopics: [
      { slug: 'sin-agua-prolongado', name: 'Sin Agua Prolongado', description: 'Comunidades sin agua por más de 24 horas', displayOrder: 1 },
      { slug: 'contingencia', name: 'Contingencia', description: 'Planes de contingencia activados', displayOrder: 2 },
      { slug: 'camiones-cisterna', name: 'Camiones Cisterna', description: 'Distribución de agua vía camiones oasis/cisterna', displayOrder: 3 },
    ],
  },
  {
    slug: 'gestion-administracion',
    name: 'Gestión / Administración',
    description: 'Aspectos administrativos y gerenciales de la agencia',
    displayOrder: 7,
    subtopics: [
      { slug: 'nombramientos', name: 'Nombramientos', description: 'Nombramientos y cambios de personal ejecutivo', displayOrder: 1 },
      { slug: 'vistas-publicas', name: 'Vistas Públicas / Cámara', description: 'Comparecencias ante la legislatura', displayOrder: 2 },
      { slug: 'auditorias', name: 'Auditorías', description: 'Auditorías e investigaciones', displayOrder: 3 },
      { slug: 'declaraciones-ejecutivas', name: 'Declaraciones Ejecutivas', description: 'Declaraciones del presidente u otros ejecutivos de AAA', displayOrder: 4 },
    ],
  },
  {
    slug: 'legislacion',
    name: 'Legislación',
    description: 'Proyectos de ley y regulación relacionados con la agencia',
    displayOrder: 8,
    subtopics: [
      { slug: 'proyectos-ley', name: 'Proyectos de Ley', description: 'Legislación propuesta que afecta a la agencia', displayOrder: 1 },
      { slug: 'resoluciones', name: 'Resoluciones', description: 'Resoluciones del Senado o Cámara', displayOrder: 2 },
      { slug: 'transparencia', name: 'Transparencia', description: 'Medidas de transparencia y rendición de cuentas', displayOrder: 3 },
    ],
  },
  {
    slug: 'impacto-comunitario',
    name: 'Impacto Comunitario',
    description: 'Efecto de las operaciones de la agencia en las comunidades',
    displayOrder: 9,
    subtopics: [
      { slug: 'municipios-afectados', name: 'Municipios Afectados', description: 'Municipios específicos impactados por interrupciones', displayOrder: 1 },
      { slug: 'sectores-residenciales', name: 'Sectores Residenciales', description: 'Residenciales y urbanizaciones afectadas', displayOrder: 2 },
      { slug: 'infraestructura-critica', name: 'Infraestructura Crítica', description: 'Impacto en aeropuertos, hospitales, escuelas', displayOrder: 3 },
    ],
  },
  {
    slug: 'medio-ambiente',
    name: 'Medio Ambiente',
    description: 'Temas ambientales relacionados con recursos hídricos',
    displayOrder: 10,
    subtopics: [
      { slug: 'embalses', name: 'Embalses', description: 'Niveles de embalses, sedimentación', displayOrder: 1 },
      { slug: 'rios', name: 'Ríos', description: 'Condición de ríos y cuencas', displayOrder: 2 },
      { slug: 'sequia', name: 'Sequía', description: 'Periodos de sequía y racionamiento', displayOrder: 3 },
    ],
  },
];

// DDEC subtopics derived from semantic analysis (10 analyst agents reading
// 1,500 sampled mentions, 150 per topic). Cap of 5 per parent, except
// `desarrollo-empresarial` and `incentivos-economicos` which use 6 — both
// excepciones documented in docs/taxonomy/ddec-subtopics-proposal.md.
export const DDECPR_TOPICS: TopicDef[] = [
  {
    slug: 'permisos-reforma',
    name: 'Permisos / Reforma',
    description: 'Reforma de permisos y procesos regulatorios para el desarrollo económico',
    displayOrder: 1,
    subtopics: [
      { slug: 'proyecto-legislativo-permisos', name: 'Proyecto Legislativo de Permisos', description: 'Tramitación técnica (PS 1183/1173, PC 1213): radicación, vistas públicas, contenido sustantivo, enmiendas, ponencias', displayOrder: 1 },
      { slug: 'pugna-fortaleza-senado', name: 'Pugna Fortaleza vs Senado', description: 'Drama político González vs Rivera Schatz, ausencias estratégicas, supremacía cláusulas — eje narrativo, no técnico', displayOrder: 2 },
      { slug: 'municipios-autonomia', name: 'Municipios y Autonomía', description: 'Asociación Alcaldes (PPD), Federación (PNP), enmiendas municipales, autonomía territorial, Consorcios Permisos', displayOrder: 3 },
      { slug: 'stakeholders-sectoriales', name: 'Stakeholders Sectoriales', description: 'Constructores, CIAPR, Colegio Arquitectos, ambientalistas, bomberos, agricultura, Cámara Comercio, comunidades (Ley 75)', displayOrder: 4 },
      { slug: 'gestion-ddec-ogpe', name: 'Gestión DDEC/OGPe', description: 'OGPe operaciones, Centro Único, Single Business Portal, IDEA/desreglamentación, crisis Almodóvar mayo 2026', displayOrder: 5 },
    ],
  },
  {
    slug: 'incentivos-economicos',
    name: 'Incentivos Económicos',
    description: 'Incentivos fiscales y económicos para empresas e inversores',
    displayOrder: 2,
    subtopics: [
      { slug: 'tu-casa-eficiente-climatizacion', name: 'Tu Casa Eficiente / Climatización', description: 'Programa Tu Casa Eficiente ($8,250 climatizar hogar), Acceso Solar, eficiencia energética', displayOrder: 1 },
      { slug: 'ley-60-22-fiscalizacion', name: 'Ley 60/22 y Fiscalización', description: 'Decretos Ley 20/22/60, OA 2026-002, GAO/IRS, controversias beneficiarios, cancelaciones, Impuesto Mínimo Global', displayOrder: 2 },
      { slug: 'ciencia-manufactura-reshoring', name: 'Ciencia, Manufactura y Reshoring', description: 'FCTIPR / Science Trust, EnTRUST Life Sciences, OE 2025-012 reshoring, expansiones PRIDCO con incentivos directos', displayOrder: 3 },
      { slug: 'pymes-jovenes-empresarios-ron', name: 'PyMEs, Jóvenes y Ron', description: 'Casco Urbano Río Piedras ($10k), Decreto Joven Empresario, Rum Tax Cover Over, webinars, propuesta IVU 4%', displayOrder: 4 },
      { slug: 'cine-cultura-turismo-creativo', name: 'Cine, Cultura y Turismo Creativo', description: 'Cine (Borealis, Hurricane Seasons, Residente/Bad Bunny), música urbana, hoteles boutique con créditos, muralismo', displayOrder: 5 },
      { slug: 'beca-teodoro-moscoso-talento', name: 'Beca Teodoro Moscoso y Talento', description: 'Beca Teodoro Moscoso, Internado Ejecutivo Luis A. Ferré, repatriación estudiantes', displayOrder: 6 },
    ],
  },
  {
    slug: 'desarrollo-empresarial',
    name: 'Desarrollo Empresarial',
    description: 'Apoyo y fomento al desarrollo de empresas locales',
    displayOrder: 3,
    subtopics: [
      { slug: 'pymes-comercio-local', name: 'PyMEs y Comercio Local', description: 'Talleres municipales, orientación a comerciantes, ferias regionales (Expo Cámara, CCPR), respuesta a apagones (centros de apoyo)', displayOrder: 1 },
      { slug: 'juventud-emprendedora', name: 'Juventud Emprendedora', description: 'Decreto Joven Empresario, Capital Semilla, Network de Jóvenes Empresarios, Programa Desarrollo Juventud', displayOrder: 2 },
      { slug: 'startups-innovacion-tech', name: 'Startups, Innovación y Tech', description: 'Parallel18, Silicon Valley, Pharos Solutions, Colmena66, Enactus, Centro Innovación, RFP semiconductores', displayOrder: 3 },
      { slug: 'mujer-empresarial', name: 'Mujer Empresarial', description: 'Programa Desarrollo Empresarial Mujer, Centro Empresarial Mayagüez, Maletín Empresarial, Women Economic Forum Caribbean', displayOrder: 4 },
      { slug: 'artesanos-cultura-empresarial', name: 'Artesanos y Cultura Empresarial', description: 'Programa Desarrollo Artesanal, Mes del Artesano, Escuela Taller (Canóvanas, Guaynabo, Ponce), artesanos certificados', displayOrder: 5 },
      { slug: 'inversion-expansion-industrial', name: 'Inversión y Expansión Industrial', description: 'Anuncios formales de expansión corporativa, atracción de inversión, reshoring, real estate PRIDCO, exportación', displayOrder: 6 },
    ],
  },
  {
    slug: 'comercio-exterior',
    name: 'Comercio Exterior',
    description: 'Exportaciones, importaciones y relaciones comerciales internacionales',
    displayOrder: 4,
    subtopics: [
      { slug: 'mision-espana-europa', name: 'Misión España y Europa', description: 'Misión Madrid-Barcelona, foro económico ES-PR, ieTeam Europa, Embajadora ES, webinar Marruecos', displayOrder: 1 },
      { slug: 'mision-republica-dominicana', name: 'Misión República Dominicana', description: 'Misión RD mayo 2025/2026, reuniones B2B, ministro Bisonó, ferries Caribe, Proindustria RD, CONEP', displayOrder: 2 },
      { slug: 'misiones-eeuu-otros-mercados', name: 'Misiones EE.UU. y Otros Mercados', description: 'Misión Florida (feb 2026), Misión Houston/Texas (jun 2026), mercados emergentes', displayOrder: 3 },
      { slug: 'promoexport-encuentros-exportadores', name: 'PromoExport y Encuentros de Exportadores', description: 'PromoExport, Going Global, Primer Encuentro Exportadores, Semana de Exportación, ExIm Bank, talleres', displayOrder: 4 },
      { slug: 'ferias-sectoriales-y-desempeno-exportador', name: 'Ferias Sectoriales y Desempeño Exportador', description: 'Interphex, BIO, Fancy Food, Expocomer + cifras macro ($62.4B 2025) + air cargo SJU + aranceles Trump', displayOrder: 5 },
    ],
  },
  {
    slug: 'turismo-economia',
    name: 'Turismo / Economía',
    description: 'Impacto del turismo en la economía de Puerto Rico',
    displayOrder: 5,
    subtopics: [
      { slug: 'aperturas-y-remodelaciones-hoteles', name: 'Aperturas y Remodelaciones Hoteleras', description: 'Wyndham Grand Rio Mar, Hyatt Centric, Aire by O:live, Holiday Inn Condado, Continental Ponce, Four Seasons', displayOrder: 1 },
      { slug: 'fitur-y-promocion-internacional', name: 'FITUR y Promoción Internacional', description: 'FITUR 2026/2027 Madrid, foros Cámara Comercio España, delegaciones turísticas', displayOrder: 2 },
      { slug: 'gastronomia-ron-y-zonas-tematicas', name: 'Gastronomía, Ron y Zonas Temáticas', description: 'Taste of Rum, Zona Turismo Gastronómico Cataño, Programa Rones PR, Bacardí turismo industrial', displayOrder: 3 },
      { slug: 'eventos-festivales-y-cultura', name: 'Eventos, Festivales y Cultura', description: 'Junte Artesanos La Parguera, Calle San Sebastián, Almojábana Lares, Puerto Rico Open, Clásico Mundial Béisbol', displayOrder: 4 },
      { slug: 'aerolineas-cruceros-conectividad', name: 'Aerolíneas, Cruceros y Conectividad', description: 'Arajet PR-RD, JetBlue, home port Caribe, FCCA, terminal marítimo Ceiba, aeropuerto Mercedita Ponce', displayOrder: 5 },
    ],
  },
  {
    slug: 'empleo-fuerza-laboral',
    name: 'Empleo / Fuerza Laboral',
    description: 'Empleo, desempleo y desarrollo de la fuerza laboral',
    displayOrder: 6,
    subtopics: [
      { slug: 'conexionlaboral-ferias-wioa', name: 'ConexiónLaboral, Ferias y WIOA', description: 'ConexiónLaboral (Plaza Las Américas, federales), ETPL onboarding, WIOA, Apprenticeship Accelerator', displayOrder: 1 },
      { slug: 'empleo-juvenil-internados-becas', name: 'Empleo Juvenil, Internados y Becas', description: 'Feria verano jóvenes 16+, Beca Teodoro Moscoso, Juvempleo, Internado Verano DDEC/PRIDCO, Internado Ejecutivo Luis A. Ferré', displayOrder: 2 },
      { slug: 'expansiones-inversion-empleo', name: 'Expansiones y Empleo por Inversión', description: 'Anuncios de empleos por inversión privada (Collins 525, Carelon 650, Pharos 118, Brightforce, reshoring norte)', displayOrder: 3 },
      { slug: 'cifras-empleo-economia', name: 'Cifras de Empleo y Economía', description: 'Datos macro (21k anuales, desempleo 5.5%) + despidos (Becton, Baxter, LUMA WARN)', displayOrder: 4 },
      { slug: 'educacion-talento-pipeline', name: 'Educación y Talento Pipeline', description: 'Alianzas academia-industria (AWS-DDEC 80hrs, RUM Centro Logística, Senado WIOA 10%, retención estudiantes)', displayOrder: 5 },
    ],
  },
  {
    slug: 'gestion-secretario',
    name: 'Gestión del Secretario',
    description: 'Declaraciones y acciones del Secretario de Desarrollo Económico',
    displayOrder: 7,
    subtopics: [
      { slug: 'designacion-confirmacion-secretario', name: 'Designación y Confirmación del Secretario', description: 'Anuncio (ene 2025) y confirmación senatorial (feb 2025) de Sebastián Negrón Reichard', displayOrder: 1 },
      { slug: 'nombramientos-equipo-ddec', name: 'Nombramientos del Equipo DDEC', description: 'Nombramientos que el Secretario hace (Lefranc PRIDCO, Ríos Pierluisi LRA Roosevelt Roads), exsecretarios', displayOrder: 2 },
      { slug: 'agenda-publica-representacion', name: 'Agenda Pública y Representación', description: 'Eventos públicos del Secretario (paneles, Business Lunch, podcasts, cumbres, reuniones con alcaldes, visitas)', displayOrder: 3 },
      { slug: 'narrativa-logros-y-vision', name: 'Narrativa de Logros y Visión', description: 'Comunicación de logros (primer año, 302→89 días permisos, 574→1041 decretos, asume IAE, defensa en medios)', displayOrder: 4 },
      { slug: 'contenido-institucional-y-reacciones', name: 'Contenido Institucional y Reacciones', description: 'Posts FB/IG/LinkedIn del DDEC con bajo signal individual (efemérides + reacciones cortas + felicitaciones)', displayOrder: 5 },
    ],
  },
  {
    slug: 'legislacion-economica',
    name: 'Legislación Económica',
    description: 'Proyectos de ley y regulación relacionados con el desarrollo económico',
    displayOrder: 8,
    subtopics: [
      { slug: 'icp-cultura-ddec', name: 'ICP y Cultura al DDEC', description: 'PS 0273 transferencia ICP, derogación Ley 89-1955, custodia patrimonio, reacciones ProSol/gremios', displayOrder: 1 },
      { slug: 'reorganizacion-funciones-ddec', name: 'Reorganización de Funciones DDEC', description: 'PC 822 separar Cía Turismo, PS 979 I+D, PC 1183 centralización, OGPe PS 764, presupuesto AF 2026-27', displayOrder: 2 },
      { slug: 'juventud-desarrollo-laboral', name: 'Juventud y Desarrollo Laboral', description: 'Comité Juventud Ahora (PC 466), Programa Desarrollo Juventud (PS 180), "Apuesta a Ti Joven", STEAM, Junta 10% diversidad', displayOrder: 3 },
      { slug: 'reforma-contributiva-incentivos', name: 'Reforma Contributiva e Incentivos', description: 'PS 912 alivio tasas, eliminación exenciones, Impuesto Mínimo Global, Ley 175-2025 empresarismo, blockchain/Ley 60', displayOrder: 4 },
      { slug: 'ambiental-territorial-recursos', name: 'Ambiental, Territorial y Recursos', description: 'PS 697 ZMT, Ley 247 gomas, plásticos pymes, La Parguera, cambio climático, energía nuclear, drones, agrícolas', displayOrder: 5 },
    ],
  },
  {
    slug: 'inversion-extranjera',
    name: 'Inversión Extranjera',
    description: 'Atracción y gestión de inversión extranjera directa',
    displayOrder: 9,
    subtopics: [
      { slug: 'farma-biotech-dispositivos', name: 'Farma, Biotech y Dispositivos', description: 'Lilly $1.2B, Amgen $650+$300M, PharmaEssentia, Terumo, Stryker, Integra, Onovexa, Millicent, Sartorius, Viant', displayOrder: 1 },
      { slug: 'aeroespacial-defensa-industrial', name: 'Aeroespacial, Defensa e Industrial', description: 'Manufactura no-farma (Collins/RTX, ABB, Bethel Protective)', displayOrder: 2 },
      { slug: 'tecnologia-servicios-bpo', name: 'Tecnología, Servicios y BPO', description: 'AI/tech/BPO (Carelon, Dot AI, Solx)', displayOrder: 3 },
      { slug: 'misiones-eventos-promocion', name: 'Misiones, Eventos y Promoción', description: 'SelectUSA, InFocus, MedTech, BIO, INTERPHEX, misiones Japón/RD/FL/España para atraer capital', displayOrder: 4 },
      { slug: 'politica-reshoring-narrativa', name: 'Política, Reshoring y Narrativa', description: 'Discurso estratégico (OE 2025-012, Grupo Reshoring, Ventanilla Única, narrativa "hub", retos energía/permisos)', displayOrder: 5 },
    ],
  },
  {
    slug: 'criticas-controversias',
    name: 'Críticas / Controversias',
    description: 'Críticas públicas y controversias relacionadas con la agencia',
    displayOrder: 10,
    subtopics: [
      { slug: 'criticas-permisos-reforma', name: 'Críticas a Reforma de Permisos', description: 'Críticas al proyecto/proceso de reforma, alianza Eliezer/Toledo, deslinde Parguera, "800 páginas truco"', displayOrder: 1 },
      { slug: 'criticas-icp-cultura', name: 'Críticas ICP / Cultura', description: 'Oposición a abolición/traspaso ICP (empleados ICP/ProSol-Utier, PPD, artistas, gremios)', displayOrder: 2 },
      { slug: 'criticas-transparencia-corrupcion', name: 'Críticas de Transparencia y Corrupción', description: 'Demanda CPI, acusaciones favoritismo/corrupción, "guisos" Ley 60, datos ocultos — piden transparencia activa', displayOrder: 3 },
      { slug: 'criticas-viajes-misiones-publicidad', name: 'Críticas a Viajes, Misiones y Publicidad', description: 'Gasto público percibido injustificado (FITUR, SelectUSA, Silicon Valley, $1.6M publicidad, ponentes)', displayOrder: 4 },
      { slug: 'criticas-impacto-economico-real', name: 'Críticas al Impacto Económico Real', description: 'Manufactura externa no contrata local + apagones/LUMA + "palabrería sin resultados" + política estructural ausente', displayOrder: 5 },
    ],
  },
];

export const TOPICS_BY_AGENCY: Record<string, TopicDef[]> = {
  aaa: AAA_TOPICS,
  ddecpr: DDECPR_TOPICS,
};

/** Backwards compat: defaults to AAA topics */
export const TOPICS = AAA_TOPICS;

export const TOPIC_SLUGS_BY_AGENCY: Record<string, string[]> = Object.fromEntries(
  Object.entries(TOPICS_BY_AGENCY).map(([key, topics]) => [key, topics.map((t) => t.slug)]),
);

/** Backwards compat: flat list of all AAA topic slugs for validation */
export const TOPIC_SLUGS = TOPIC_SLUGS_BY_AGENCY.aaa;

export const SUBTOPIC_SLUGS_BY_AGENCY: Record<string, string[]> = Object.fromEntries(
  Object.entries(TOPICS_BY_AGENCY).map(([key, topics]) => [
    key,
    topics.flatMap((t) => t.subtopics.map((s) => s.slug)),
  ]),
);

/** Backwards compat: flat list of all AAA subtopic slugs (prefixed with topic) for validation */
export const SUBTOPIC_SLUGS = TOPICS.flatMap((t) => t.subtopics.map((s) => `${t.slug}/${s.slug}`));
