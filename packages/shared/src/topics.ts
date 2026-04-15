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

export const DDECPR_TOPICS: TopicDef[] = [
  {
    slug: 'permisos-reforma',
    name: 'Permisos / Reforma',
    description: 'Reforma de permisos y procesos regulatorios para el desarrollo económico',
    displayOrder: 1,
    subtopics: [],
  },
  {
    slug: 'incentivos-economicos',
    name: 'Incentivos Económicos',
    description: 'Incentivos fiscales y económicos para empresas e inversores',
    displayOrder: 2,
    subtopics: [],
  },
  {
    slug: 'desarrollo-empresarial',
    name: 'Desarrollo Empresarial',
    description: 'Apoyo y fomento al desarrollo de empresas locales',
    displayOrder: 3,
    subtopics: [],
  },
  {
    slug: 'comercio-exterior',
    name: 'Comercio Exterior',
    description: 'Exportaciones, importaciones y relaciones comerciales internacionales',
    displayOrder: 4,
    subtopics: [],
  },
  {
    slug: 'turismo-economia',
    name: 'Turismo / Economía',
    description: 'Impacto del turismo en la economía de Puerto Rico',
    displayOrder: 5,
    subtopics: [],
  },
  {
    slug: 'empleo-fuerza-laboral',
    name: 'Empleo / Fuerza Laboral',
    description: 'Empleo, desempleo y desarrollo de la fuerza laboral',
    displayOrder: 6,
    subtopics: [],
  },
  {
    slug: 'gestion-secretario',
    name: 'Gestión del Secretario',
    description: 'Declaraciones y acciones del Secretario de Desarrollo Económico',
    displayOrder: 7,
    subtopics: [],
  },
  {
    slug: 'legislacion-economica',
    name: 'Legislación Económica',
    description: 'Proyectos de ley y regulación relacionados con el desarrollo económico',
    displayOrder: 8,
    subtopics: [],
  },
  {
    slug: 'inversion-extranjera',
    name: 'Inversión Extranjera',
    description: 'Atracción y gestión de inversión extranjera directa',
    displayOrder: 9,
    subtopics: [],
  },
  {
    slug: 'criticas-controversias',
    name: 'Críticas / Controversias',
    description: 'Críticas públicas y controversias relacionadas con la agencia',
    displayOrder: 10,
    subtopics: [],
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
