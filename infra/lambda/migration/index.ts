/**
 * Migration Lambda — Runs Drizzle schema push + seed against RDS.
 * Invoked manually via AWS CLI, not scheduled.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});
const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;

export const handler = async (event: { action?: string; query?: string }): Promise<{ statusCode: number; body: string }> => {
  const action = event.action ?? 'migrate-and-seed';
  console.log(`Migration handler invoked with action: ${action}`);

  const dbUrl = await getDatabaseUrl();

  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    if (action === 'migrate' || action === 'migrate-and-seed') {
      await runMigrations(client);
    }
    if (action === 'seed' || action === 'migrate-and-seed') {
      await runSeed(client);
    }
    if (action === 'status') {
      return await getStatus(client);
    }
    if (action === 'get-agency-id') {
      const res = await client.query("SELECT id FROM agencies WHERE slug = 'aaa'");
      return { statusCode: 200, body: res.rows[0]?.id ?? 'NOT_FOUND' };
    }
    if (action === 'custom-query' && event.query) {
      // Read-only queries for diagnostics
      const selectOnly = event.query.trim().toLowerCase();
      if (!selectOnly.startsWith('select')) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Only SELECT queries allowed' }) };
      }
      const res = await client.query(event.query);
      return { statusCode: 200, body: JSON.stringify({ rows: res.rows, rowCount: res.rowCount }) };
    }
    if (action === 'cleanup-empty-mentions') {
      // Delete mentions with no usable content (e.g. Twitter with no date/snippet/title)
      const del = await client.query(
        `DELETE FROM mentions WHERE snippet IS NULL AND title IS NULL RETURNING id`,
      );
      return { statusCode: 200, body: JSON.stringify({ deleted: del.rowCount }) };
    }

    return { statusCode: 200, body: `Action '${action}' completed successfully` };
  } finally {
    await client.end();
  }
};

async function runMigrations(client: any): Promise<void> {
  console.log('Running schema migrations...');

  // Create enums
  await client.query(`
    DO $$ BEGIN
      CREATE TYPE user_role AS ENUM ('admin', 'analyst', 'viewer');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  // agencies
  await client.query(`
    CREATE TABLE IF NOT EXISTS agencies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      brandwatch_project_id BIGINT,
      brandwatch_query_ids JSONB,
      logo_url VARCHAR(500),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
  `);

  // users
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cognito_sub VARCHAR(255) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      role user_role NOT NULL,
      agency_id UUID NOT NULL REFERENCES agencies(id),
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_login TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // topics
  await client.query(`
    CREATE TABLE IF NOT EXISTS topics (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true
    );
  `);

  // subtopics
  await client.query(`
    CREATE TABLE IF NOT EXISTS subtopics (
      id SERIAL PRIMARY KEY,
      topic_id INTEGER NOT NULL REFERENCES topics(id),
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) NOT NULL,
      description TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      UNIQUE(topic_id, slug)
    );
  `);

  // municipalities
  await client.query(`
    CREATE TABLE IF NOT EXISTS municipalities (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      region VARCHAR(50) NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      population INTEGER NOT NULL DEFAULT 0
    );
  `);

  // mentions (core table)
  await client.query(`
    CREATE TABLE IF NOT EXISTS mentions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      bw_resource_id VARCHAR(255) NOT NULL UNIQUE,
      bw_guid VARCHAR(255),
      bw_query_id BIGINT NOT NULL,
      bw_query_name VARCHAR(255),
      title TEXT,
      snippet TEXT,
      url TEXT,
      original_url TEXT,
      author VARCHAR(255),
      author_fullname VARCHAR(255),
      author_gender VARCHAR(20),
      author_avatar_url TEXT,
      domain VARCHAR(255),
      page_type VARCHAR(50) NOT NULL,
      content_source VARCHAR(50),
      content_source_name VARCHAR(100),
      pub_type VARCHAR(50),
      subtype VARCHAR(50),
      likes INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      engagement_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      impact DOUBLE PRECISION NOT NULL DEFAULT 0,
      reach_estimate INTEGER NOT NULL DEFAULT 0,
      potential_audience INTEGER NOT NULL DEFAULT 0,
      monthly_visitors BIGINT NOT NULL DEFAULT 0,
      bw_country VARCHAR(100),
      bw_country_code VARCHAR(10),
      bw_region VARCHAR(100),
      bw_city VARCHAR(100),
      bw_city_code VARCHAR(100),
      bw_sentiment VARCHAR(20),
      nlp_sentiment VARCHAR(20),
      nlp_emotions JSONB,
      nlp_pertinence VARCHAR(10),
      nlp_summary TEXT,
      text_hash VARCHAR(64),
      is_duplicate BOOLEAN NOT NULL DEFAULT false,
      duplicate_of_id UUID,
      media_urls JSONB,
      has_image BOOLEAN NOT NULL DEFAULT false,
      has_video BOOLEAN NOT NULL DEFAULT false,
      published_at TIMESTAMPTZ NOT NULL,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      language VARCHAR(10) NOT NULL DEFAULT 'es'
    );
  `);

  // mention indexes
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_agency_id ON mentions(agency_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_published_at ON mentions(published_at DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_nlp_sentiment ON mentions(nlp_sentiment);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_page_type ON mentions(page_type);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_text_hash ON mentions(text_hash);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mentions_domain ON mentions(domain);`);

  // mention_topics junction
  await client.query(`
    CREATE TABLE IF NOT EXISTS mention_topics (
      mention_id UUID NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
      topic_id INTEGER NOT NULL REFERENCES topics(id),
      subtopic_id INTEGER REFERENCES subtopics(id),
      confidence DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (mention_id, topic_id)
    );
  `);

  // mention_municipalities junction
  await client.query(`
    CREATE TABLE IF NOT EXISTS mention_municipalities (
      mention_id UUID NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
      municipality_id INTEGER NOT NULL REFERENCES municipalities(id),
      source VARCHAR(20) NOT NULL,
      PRIMARY KEY (mention_id, municipality_id)
    );
  `);

  // alert_rules
  await client.query(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      config JSONB NOT NULL,
      notify_emails JSONB NOT NULL,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_alert_rules_agency_id ON alert_rules(agency_id);`);

  // alert_history
  await client.query(`
    CREATE TABLE IF NOT EXISTS alert_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      alert_rule_id UUID NOT NULL REFERENCES alert_rules(id),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      triggered_at TIMESTAMPTZ NOT NULL,
      mention_ids JSONB,
      details JSONB,
      notification_sent BOOLEAN NOT NULL DEFAULT false,
      sent_at TIMESTAMPTZ
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_alert_history_agency_id ON alert_history(agency_id);`);

  // ingestion_cursors
  await client.query(`
    CREATE TABLE IF NOT EXISTS ingestion_cursors (
      query_id BIGINT PRIMARY KEY,
      last_mention_date TIMESTAMPTZ NOT NULL,
      last_run_at TIMESTAMPTZ NOT NULL,
      mentions_fetched INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'idle'
    );
  `);

  // daily_metric_snapshots
  await client.query(`
    CREATE TABLE IF NOT EXISTS daily_metric_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      date DATE NOT NULL,
      total_mentions INTEGER NOT NULL DEFAULT 0,
      positive_count INTEGER NOT NULL DEFAULT 0,
      neutral_count INTEGER NOT NULL DEFAULT 0,
      negative_count INTEGER NOT NULL DEFAULT 0,
      high_pertinence_count INTEGER NOT NULL DEFAULT 0,
      total_likes INTEGER NOT NULL DEFAULT 0,
      total_comments INTEGER NOT NULL DEFAULT 0,
      total_shares INTEGER NOT NULL DEFAULT 0,
      total_reach BIGINT NOT NULL DEFAULT 0,
      total_impact DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_engagement_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      nss DOUBLE PRECISION,
      brand_health_index DOUBLE PRECISION,
      reputation_momentum DOUBLE PRECISION,
      engagement_rate DOUBLE PRECISION,
      amplification_rate DOUBLE PRECISION,
      engagement_velocity DOUBLE PRECISION,
      crisis_risk_score DOUBLE PRECISION,
      volume_anomaly_zscore DOUBLE PRECISION,
      nss_7d DOUBLE PRECISION,
      nss_30d DOUBLE PRECISION,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(agency_id, date)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_daily_metrics_agency_crisis ON daily_metric_snapshots(agency_id, crisis_risk_score);`);

  console.log('Schema migrations completed successfully');
}

async function runSeed(client: any): Promise<void> {
  console.log('Running seed data...');

  // Seed AAA agency
  await client.query(`
    INSERT INTO agencies (name, slug, brandwatch_project_id, brandwatch_query_ids)
    VALUES ('Autoridad de Acueductos y Alcantarillados', 'aaa', 1998403803, '[2003911540]'::jsonb)
    ON CONFLICT (slug) DO NOTHING;
  `);
  console.log('  -> AAA agency seeded');

  // Seed municipalities (all 78)
  const municipalities = [
    ['san-juan','San Juan','Metro',18.4655,-66.1057,318441],['bayamon','Bayamón','Metro',18.3985,-66.1553,170110],['carolina','Carolina','Metro',18.3811,-65.9574,146984],['guaynabo','Guaynabo','Metro',18.3566,-66.1108,89780],['trujillo-alto','Trujillo Alto','Metro',18.3547,-66.0074,67740],['catano','Cataño','Metro',18.4414,-66.1181,24888],['toa-baja','Toa Baja','Metro',18.4442,-66.2546,75204],['toa-alta','Toa Alta','Metro',18.3882,-66.2484,68025],['arecibo','Arecibo','Norte',18.4725,-66.7157,87242],['manati','Manatí','Norte',18.4319,-66.4835,38692],['vega-baja','Vega Baja','Norte',18.4443,-66.3907,54414],['vega-alta','Vega Alta','Norte',18.4123,-66.3312,37910],['dorado','Dorado','Norte',18.4589,-66.2678,37688],['barceloneta','Barceloneta','Norte',18.4512,-66.5385,22322],['camuy','Camuy','Norte',18.4839,-66.8449,30466],['hatillo','Hatillo','Norte',18.4866,-66.7883,37945],['quebradillas','Quebradillas','Norte',18.4729,-66.9386,23423],['isabela','Isabela','Norte',18.5000,-67.0244,42420],['loiza','Loíza','Norte',18.4313,-65.8783,24553],['rio-grande','Río Grande','Norte',18.3802,-65.8314,48025],['luquillo','Luquillo','Norte',18.3726,-65.7165,18547],['caguas','Caguas','Este',18.2388,-66.0486,127244],['humacao','Humacao','Este',18.1497,-65.8198,50896],['fajardo','Fajardo','Este',18.3258,-65.6525,32240],['juncos','Juncos','Este',18.2276,-65.9211,37165],['las-piedras','Las Piedras','Este',18.1831,-65.8666,36110],['gurabo','Gurabo','Este',18.2542,-65.9730,45369],['san-lorenzo','San Lorenzo','Este',18.1895,-65.9607,37873],['naguabo','Naguabo','Este',18.2115,-65.7347,25718],['yabucoa','Yabucoa','Este',18.0507,-65.8792,32282],['ceiba','Ceiba','Este',18.2632,-65.6487,11853],['culebra','Culebra','Este',18.3103,-65.3028,1714],['vieques','Vieques','Este',18.1263,-65.4401,8249],['aguas-buenas','Aguas Buenas','Este',18.2570,-66.1021,25314],['cidra','Cidra','Este',18.1759,-66.1612,38307],['cayey','Cayey','Este',18.1119,-66.1660,44015],['maunabo','Maunabo','Este',18.0072,-65.8992,10679],['patillas','Patillas','Este',18.0038,-65.9966,16468],['mayaguez','Mayagüez','Oeste',18.2013,-67.1397,71083],['aguadilla','Aguadilla','Oeste',18.4274,-67.1541,54166],['cabo-rojo','Cabo Rojo','Oeste',18.0866,-67.1457,46024],['san-german','San Germán','Oeste',18.0831,-67.0359,30227],['anasco','Añasco','Oeste',18.2828,-67.1395,26322],['rincon','Rincón','Oeste',18.3402,-67.2499,14293],['aguada','Aguada','Oeste',18.3793,-67.1876,37516],['moca','Moca','Oeste',18.3949,-67.1131,36019],['san-sebastian','San Sebastián','Oeste',18.3367,-66.9904,36249],['las-marias','Las Marías','Oeste',18.2518,-66.9910,8606],['hormigueros','Hormigueros','Oeste',18.1395,-67.1270,15806],['lajas','Lajas','Oeste',18.0498,-67.0591,23315],['sabana-grande','Sabana Grande','Oeste',18.0786,-66.9608,22284],['maricao','Maricao','Oeste',18.1808,-66.9800,5318],['ponce','Ponce','Sur',18.0111,-66.6141,132502],['guayama','Guayama','Sur',17.9843,-66.1117,37685],['juana-diaz','Juana Díaz','Sur',18.0535,-66.5065,44790],['salinas','Salinas','Sur',18.0021,-66.2576,27518],['santa-isabel','Santa Isabel','Sur',17.9661,-66.4049,21384],['coamo','Coamo','Sur',18.0799,-66.3580,38336],['guanica','Guánica','Sur',17.9715,-66.9074,15228],['yauco','Yauco','Sur',18.0352,-66.8499,35025],['guayanilla','Guayanilla','Sur',18.0193,-66.7917,17623],['penuelas','Peñuelas','Sur',18.0563,-66.7260,19267],['arroyo','Arroyo','Sur',17.9665,-66.0613,17111],['villalba','Villalba','Sur',18.1277,-66.4924,22093],['utuado','Utuado','Central',18.2655,-66.7008,28186],['lares','Lares','Central',18.2957,-66.8780,25647],['adjuntas','Adjuntas','Central',18.1627,-66.7224,17024],['jayuya','Jayuya','Central',18.2183,-66.5916,14536],['ciales','Ciales','Central',18.3368,-66.4689,16374],['morovis','Morovis','Central',18.3253,-66.4075,29612],['orocovis','Orocovis','Central',18.2269,-66.3912,20791],['barranquitas','Barranquitas','Central',18.1863,-66.3063,27725],['aibonito','Aibonito','Central',18.1400,-66.2661,23457],['comerio','Comerío','Central',18.2189,-66.2256,18648],['naranjito','Naranjito','Central',18.3009,-66.2450,27914],['corozal','Corozal','Central',18.3417,-66.3168,33478],['florida','Florida','Central',18.3626,-66.5717,11254],
  ];

  for (const [slug, name, region, lat, lon, pop] of municipalities) {
    await client.query(`
      INSERT INTO municipalities (name, slug, region, latitude, longitude, population)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (slug) DO NOTHING
    `, [name, slug, region, lat, lon, pop]);
  }
  console.log(`  -> ${municipalities.length} municipalities seeded`);

  // Seed topics and subtopics
  const topicsData: Array<[string, string, string, number, Array<[string, string, string, number]>]> = [
    ['averias-interrupciones', 'Averías / Interrupciones', 'Fallas técnicas que interrumpen el servicio', 1, [
      ['bombeo-represas', 'Bombeo / Represas', 'Fallas en bombas y represas', 1],
      ['plantas-filtracion', 'Plantas de Filtración', 'Plantas fuera de servicio', 2],
      ['tuberias-fugas', 'Tuberías / Fugas', 'Roturas y fugas en la red', 3],
      ['apagones-infraestructura', 'Apagones en Infraestructura', 'Fallas eléctricas en plantas/bombas', 4],
    ]],
    ['calidad-agua', 'Calidad del Agua', 'Problemas de calidad del agua potable', 2, [
      ['turbidez', 'Turbidez', 'Alta turbidez en fuentes', 1],
      ['contaminacion', 'Contaminación', 'Contaminación química o biológica', 2],
      ['presion-baja', 'Presión Baja', 'Baja presión en sectores', 3],
    ]],
    ['conflictos-inter-agencia', 'Conflictos Inter-Agencia', 'Disputas entre AAA y otras entidades', 3, [
      ['aaa-vs-luma', 'AAA vs LUMA', 'Conflictos con LUMA Energy', 1],
      ['aaa-vs-municipios', 'AAA vs Municipios', 'Disputas con gobiernos municipales', 2],
      ['aaa-vs-legislatura', 'AAA vs Legislatura', 'Cuestionamientos legislativos', 3],
    ]],
    ['infraestructura', 'Infraestructura', 'Inversiones y mejoras a infraestructura', 4, [
      ['obras-nuevas', 'Obras Nuevas', 'Nueva infraestructura', 1],
      ['renovacion', 'Renovación', 'Renovación de equipos y tuberías', 2],
      ['fondos-federales', 'Fondos FEMA / Federales', 'Asignaciones federales', 3],
      ['inversiones', 'Inversiones', 'Inversiones generales', 4],
    ]],
    ['servicio-cliente', 'Servicio al Cliente', 'Experiencia del cliente', 5, [
      ['facturacion-depositos', 'Facturación / Depósitos', 'Tarifas y pagos', 1],
      ['quejas', 'Quejas', 'Quejas generales del público', 2],
      ['comunicacion-deficiente', 'Comunicación Deficiente', 'Falta de información', 3],
    ]],
    ['crisis-emergencias', 'Crisis / Emergencias', 'Situaciones de emergencia', 6, [
      ['sin-agua-prolongado', 'Sin Agua Prolongado', 'Comunidades sin agua >24h', 1],
      ['contingencia', 'Contingencia', 'Planes de contingencia', 2],
      ['camiones-cisterna', 'Camiones Cisterna', 'Distribución de agua vía cisterna', 3],
    ]],
    ['gestion-administracion', 'Gestión / Administración', 'Aspectos gerenciales', 7, [
      ['nombramientos', 'Nombramientos', 'Cambios de personal ejecutivo', 1],
      ['vistas-publicas', 'Vistas Públicas / Cámara', 'Comparecencias legislativas', 2],
      ['auditorias', 'Auditorías', 'Auditorías e investigaciones', 3],
      ['declaraciones-ejecutivas', 'Declaraciones Ejecutivas', 'Declaraciones de ejecutivos AAA', 4],
    ]],
    ['legislacion', 'Legislación', 'Proyectos de ley y regulación', 8, [
      ['proyectos-ley', 'Proyectos de Ley', 'Legislación propuesta', 1],
      ['resoluciones', 'Resoluciones', 'Resoluciones del Senado/Cámara', 2],
      ['transparencia', 'Transparencia', 'Medidas de transparencia', 3],
    ]],
    ['impacto-comunitario', 'Impacto Comunitario', 'Efecto en las comunidades', 9, [
      ['municipios-afectados', 'Municipios Afectados', 'Municipios impactados', 1],
      ['sectores-residenciales', 'Sectores Residenciales', 'Residenciales afectadas', 2],
      ['infraestructura-critica', 'Infraestructura Crítica', 'Aeropuertos, hospitales, escuelas', 3],
    ]],
    ['medio-ambiente', 'Medio Ambiente', 'Temas ambientales hídricos', 10, [
      ['embalses', 'Embalses', 'Niveles y sedimentación', 1],
      ['rios', 'Ríos', 'Condición de ríos y cuencas', 2],
      ['sequia', 'Sequía', 'Periodos de sequía', 3],
    ]],
  ];

  for (const [slug, name, desc, order, subtopics] of topicsData) {
    const res = await client.query(`
      INSERT INTO topics (name, slug, description, display_order)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (slug) DO UPDATE SET name = $1
      RETURNING id
    `, [name, slug, desc, order]);
    const topicId = res.rows[0].id;

    for (const [sSlug, sName, sDesc, sOrder] of subtopics) {
      await client.query(`
        INSERT INTO subtopics (topic_id, name, slug, description, display_order)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (topic_id, slug) DO NOTHING
      `, [topicId, sName, sSlug, sDesc, sOrder]);
    }
  }

  const totalSubtopics = topicsData.reduce((s, t) => s + t[4].length, 0);
  console.log(`  -> ${topicsData.length} topics, ${totalSubtopics} subtopics seeded`);
  console.log('Seed completed successfully');
}

async function getStatus(client: any): Promise<{ statusCode: number; body: string }> {
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  const agencies = await client.query('SELECT count(*) FROM agencies');
  const municipalities = await client.query('SELECT count(*) FROM municipalities');
  const topics = await client.query('SELECT count(*) FROM topics');
  const mentions = await client.query('SELECT count(*) FROM mentions');

  const status = {
    tables: tables.rows.map((r: any) => r.table_name),
    counts: {
      agencies: agencies.rows[0].count,
      municipalities: municipalities.rows[0].count,
      topics: topics.rows[0].count,
      mentions: mentions.rows[0].count,
    },
  };

  return { statusCode: 200, body: JSON.stringify(status, null, 2) };
}

async function getDatabaseUrl(): Promise<string> {
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }),
  );
  const parsed = JSON.parse(secret.SecretString!);
  return `postgresql://${parsed.username}:${encodeURIComponent(parsed.password)}@${parsed.host}:${parsed.port}/${parsed.dbname}`;
}
