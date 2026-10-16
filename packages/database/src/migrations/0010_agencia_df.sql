-- 0010 — DF, Departamento de la Familia (oct-2026).
--
-- Primera agencia que NO entra por Brandwatch: sus menciones llegan como
-- exportes xlsx de Bunker y se cargan con scripts/import-bunker-xlsx.ts, que
-- las encola en SQS eco-ingestion con queryId -1001. Por eso:
--   - brandwatch_project_id = NULL → eco-ingestion no la consulta en la API
--     de Brandwatch (selecciona brandwatch_project_id IS NOT NULL);
--   - brandwatch_query_ids = [-1001] → eco-processor mapea el queryId a la
--     agencia, y el dashboard no la marca «archivada» (isArchivedAgency).
-- Los tópicos son los de DF_TOPICS en @eco/shared/topics.ts (los slugs deben
-- coincidir EXACTOS: el processor descarta lo que no esté en la tabla).
--
-- Correos: el reporte (diario + semanal) y la regla de crisis van al equipo
-- de Populicom. `updated_by` NOT NULL es obligatorio: sin él, el reseed
-- horario de eco-weekly-report vuelve la fila a inactiva y sin destinatarios.
-- Las usuarias externas del DDEC no reciben DF (decisión del 16-oct-2026).
-- El acceso al dashboard no necesita filas: el staff tiene all_agencies.
--
-- Idempotente; se aplicó en prod sentencia por sentencia vía exec-write.

INSERT INTO agencies (name, slug, brandwatch_project_id, brandwatch_query_ids, is_active)
VALUES ('Departamento de la Familia', 'df', NULL, '[-1001]'::jsonb, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO topics (agency_id, slug, name, description, display_order, is_active)
SELECT a.id, v.slug, v.name, v.description, v.display_order, true
FROM agencies a
CROSS JOIN (VALUES
  ('controversia-adsef', 'Controversia ADSEF y Contratos', 'Contrato de $38.5 millones (Star Academy / NOLA Education), destitución de la administradora de ADSEF, investigaciones y otros contratos cuestionados', 1),
  ('gestion-secretaria', 'Gestión de la Secretaria', 'Liderazgo, credibilidad y continuidad de quien dirige el Departamento: respaldo de la Gobernadora, llamados a renuncia y su agenda pública', 2),
  ('adultos-mayores-cuido', 'Adultos Mayores y Hogares de Cuido', 'Licenciamiento, fiscalización, maltrato y pagos en hogares de cuidado prolongado; protección de personas de edad avanzada y con discapacidad', 3),
  ('proteccion-menores', 'Protección de Menores', 'ADFAN: maltrato infantil, custodia, hogares de menores, menores evadidos o desaparecidos, adopción y prevención', 4),
  ('asistencia-social', 'Asistencia Nutricional y Económica', 'ADSEF y ASUME: PAN y Tarjeta de la Familia, transición a SNAP, TANF y otras ayudas, pensiones alimentarias, pobreza y sinhogarismo', 5),
  ('cuido-ninez-acuden', 'Cuidado y Desarrollo de la Niñez', 'ACUDEN: Head Start y Early Head Start, centros de cuido infantil y servicios a la niñez temprana', 6),
  ('operacion-presupuesto', 'Operación, Personal y Presupuesto', 'Presupuesto y fondos, personal y trabajo social, contratos de servicios, sistemas y pagos a proveedores del Departamento', 7),
  ('legislacion-politica-publica', 'Legislación y Política Pública', 'Proyectos de ley, resoluciones, vistas y política pública sobre familia, niñez, adultos mayores y bienestar social (fuera del caso ADSEF)', 8),
  ('iniciativas-comunicacion', 'Iniciativas y Comunicación Institucional', 'Comunicación oficial del Departamento: campañas, orientación, eventos comunitarios, alianzas y respuesta a emergencias', 9)
) AS v(slug, name, description, display_order)
WHERE a.slug = 'df'
ON CONFLICT (agency_id, slug) DO NOTHING;

INSERT INTO subtopics (topic_id, slug, name, description, display_order, is_active)
SELECT t.id, v.slug, v.name, v.description, v.display_order, true
FROM topics t
JOIN agencies a ON a.id = t.agency_id AND a.slug = 'df'
JOIN (VALUES
  ('controversia-adsef', 'contrato-star-academy', 'Contrato Star Academy / NOLA', 'Propuesta de $38.5 millones con fondos TANF, evaluación de LAP Consulting, Coccoloba y las demás proponentes', 1),
  ('controversia-adsef', 'destitucion-blanca-medina', 'Destitución en ADSEF', 'Despido de la administradora de ADSEF (Blanca Medina), sus alegaciones de presión y la respuesta del Departamento', 2),
  ('controversia-adsef', 'investigacion-senado', 'Investigación del Senado', 'Vistas públicas, citaciones, requerimientos de documentos y comisiones legislativas sobre el caso', 3),
  ('controversia-adsef', 'justicia-fbi-oig', 'Justicia, FBI e Inspectora General', 'Referidos y pesquisas del Departamento de Justicia, FBI, Oficina del Inspector General, Contralor y Ética', 4),
  ('controversia-adsef', 'viajes-otros-contratos', 'Viajes y Otros Contratos', 'Viajes oficiales de la secretaria (España, Luisiana), contrato con Samu Foundation, alquileres y otros gastos cuestionados', 5),
  ('gestion-secretaria', 'respaldo-confianza', 'Respaldo y Confianza', 'La Gobernadora, el gabinete u otras voces respaldan o retiran su confianza a la secretaria', 1),
  ('gestion-secretaria', 'llamados-renuncia', 'Llamados a Renuncia', 'Legisladores, partidos o ciudadanos piden su renuncia o destitución; ella responde que no renunciará', 2),
  ('gestion-secretaria', 'imagen-credibilidad', 'Imagen y Credibilidad', 'Contradicciones, acusaciones de mentir, momentos virales (lágrimas, pañuelo, escolta) y críticas a su persona', 3),
  ('gestion-secretaria', 'agenda-entrevistas', 'Agenda y Entrevistas', 'Entrevistas en medios, comparecencias, reuniones y actividades públicas de la secretaria', 4),
  ('adultos-mayores-cuido', 'licenciamiento-cierres', 'Licenciamiento y Cierres', 'Inspecciones, licencias, hogares clandestinos y cierres de hogares de cuidado prolongado', 1),
  ('adultos-mayores-cuido', 'maltrato-adultos-mayores', 'Maltrato y Negligencia', 'Casos de maltrato, abuso, negligencia o explotación financiera de adultos mayores, Ley 121 y cargos criminales', 2),
  ('adultos-mayores-cuido', 'pagos-hogares', 'Pagos y Deuda a Hogares', 'Atrasos y deuda con los hogares de cuido, pagos por participantes fallecidos, ÍntegraPR y reclamos de los dueños', 3),
  ('adultos-mayores-cuido', 'discapacidad-intelectual', 'Personas con Discapacidad', 'Hogares y servicios para adultos con discapacidad intelectual, remociones y reubicación de participantes', 4),
  ('proteccion-menores', 'maltrato-infantil', 'Maltrato y Negligencia Infantil', 'Casos de maltrato, abuso sexual o negligencia contra menores en los que interviene o se cuestiona a Familia', 1),
  ('proteccion-menores', 'custodia-hogares-menores', 'Custodia y Hogares de Menores', 'Menores bajo custodia del Estado, hogares de grupo, menores evadidos o desaparecidos y remociones', 2),
  ('proteccion-menores', 'adopcion-hogares-sustitutos', 'Adopción y Hogares Sustitutos', 'Adopciones, hogares de crianza (foster), jóvenes que salen del sistema', 3),
  ('proteccion-menores', 'prevencion-campanas', 'Prevención y Campañas', 'Campañas contra el maltrato, línea de ayuda, capacitaciones y coordinación interagencial para proteger a la niñez', 4),
  ('asistencia-social', 'pan-tarjeta-familia', 'PAN / Tarjeta de la Familia', 'Beneficios del PAN, solicitudes y renovaciones, compras en línea, casos pendientes, fraude o uso indebido', 1),
  ('asistencia-social', 'transicion-snap', 'Transición a SNAP', 'Paso del PAN a SNAP, Farm Bill, gestiones en el Congreso y fondos federales de nutrición', 2),
  ('asistencia-social', 'tanf-ayudas', 'TANF y Otras Ayudas', 'TANF, subsidios de energía (LIHEAP), ayudas económicas de emergencia y su uso', 3),
  ('asistencia-social', 'asume-pension-alimentaria', 'ASUME / Pensión Alimentaria', 'Pensiones alimentarias, cobro y servicios de ASUME', 4),
  ('asistencia-social', 'pobreza-sinhogarismo', 'Pobreza y Sinhogarismo', 'Programas y datos sobre pobreza, personas sin hogar y jóvenes en riesgo', 5),
  ('cuido-ninez-acuden', 'head-start-fondos', 'Head Start y Fondos Federales', 'Programas Head Start / Early Head Start y el riesgo o la asignación de sus fondos federales', 1),
  ('cuido-ninez-acuden', 'centros-cuido-infantil', 'Centros de Cuido Infantil', 'Licencias, inspecciones, incidentes y capacitación en centros de cuido para infantes y niños', 2),
  ('cuido-ninez-acuden', 'servicios-familias-ninez', 'Servicios a Familias', 'Ferias, Centros 2 Generaciones, programas educativos y orientación a padres', 3),
  ('operacion-presupuesto', 'presupuesto-fondos', 'Presupuesto y Fondos', 'Presupuesto, Junta de Supervisión Fiscal, asignaciones y fondos federales de la agencia', 1),
  ('operacion-presupuesto', 'personal-trabajo-social', 'Personal y Trabajo Social', 'Trabajadores sociales, vacantes, amas de llaves, nombramientos, salarios y condiciones de los empleados', 2),
  ('operacion-presupuesto', 'sistemas-pagos-proveedores', 'Sistemas y Pagos a Proveedores', 'ÍntegraPR, atrasos a proveedores y profesionales contratados, tecnología y procesos administrativos', 3),
  ('legislacion-politica-publica', 'proyectos-medidas', 'Proyectos y Medidas', 'Proyectos de ley, resoluciones y leyes firmadas o vetadas que afectan los servicios de Familia', 1),
  ('legislacion-politica-publica', 'vistas-servicios', 'Vistas y Fiscalización de Servicios', 'Vistas e investigaciones legislativas sobre servicios (hogares, menores, PAN) que no son el caso ADSEF', 2),
  ('iniciativas-comunicacion', 'orientacion-servicios', 'Orientación sobre Servicios', 'Podcast «Desayunando en Familia», guías, requisitos y explicaciones de programas y trámites', 1),
  ('iniciativas-comunicacion', 'eventos-comunitarios', 'Eventos e Impactos Comunitarios', 'Ferias, impactos comunitarios, actividades deportivas o culturales y reconocimientos', 2),
  ('iniciativas-comunicacion', 'alianzas-interagenciales', 'Alianzas Interagenciales', 'Acuerdos, cumbres y coordinación con otras agencias, municipios, el gobierno federal y organizaciones', 3),
  ('iniciativas-comunicacion', 'respuesta-emergencias', 'Respuesta a Emergencias', 'Protocolos y servicios ante emergencias: racionamiento de agua, huracanes, incendios y desastres', 4)
) AS v(topic_slug, slug, name, description, display_order) ON v.topic_slug = t.slug
ON CONFLICT (topic_id, slug) DO NOTHING;

INSERT INTO report_configs (agency_id, is_active, send_hour_local, timezone, template_key, recipients, from_email, from_name,
                            updated_by, weekly_enabled, weekly_send_dow, weekly_send_hour_local)
SELECT a.id, true, 6, 'America/Puerto_Rico', 'daily-sentiment-summary',
       '["agutierrez@populicom.com","ajovane@populicom.com","aruiz@populicom.com","asoto@populicom.com","csanchez@populicom.com","gpaz@populicom.com","grosado@populicom.com","hlopez@populicom.com","lquinones@populicom.com","mgratacos@populicom.com"]'::jsonb,
       'alerts@citizenecho.com', 'ECO Radar',
       (SELECT id FROM users WHERE email = 'agutierrez@populicom.com'), true, 5, 15
FROM agencies a
WHERE a.slug = 'df'
ON CONFLICT (agency_id) DO UPDATE SET
  is_active = true,
  send_hour_local = 6,
  timezone = 'America/Puerto_Rico',
  template_key = 'daily-sentiment-summary',
  recipients = EXCLUDED.recipients,
  from_name = 'ECO Radar',
  from_email = EXCLUDED.from_email,
  updated_by = EXCLUDED.updated_by,
  weekly_enabled = true,
  updated_at = NOW();

INSERT INTO alert_rules (agency_id, name, config, is_active, notify_emails)
SELECT a.id, 'Crisis Score · umbral',
       '{"type":"crisis_threshold","crisis_min":0.4,"severity_min":0.5,"cooldown_hours":12}'::jsonb,
       true,
       '["agutierrez@populicom.com","ajovane@populicom.com","aruiz@populicom.com","asoto@populicom.com","csanchez@populicom.com","gpaz@populicom.com","grosado@populicom.com","hlopez@populicom.com","lquinones@populicom.com","mgratacos@populicom.com"]'::jsonb
FROM agencies a
WHERE a.slug = 'df'
  AND NOT EXISTS (
    SELECT 1 FROM alert_rules ar WHERE ar.agency_id = a.id AND ar.config->>'type' = 'crisis_threshold'
  );
