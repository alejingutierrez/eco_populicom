import { getDb } from '../client.js';
import { agencies, topics, subtopics, municipalities } from '../schema/index.js';
import { TOPICS_BY_AGENCY } from '@eco/shared';
import { MUNICIPALITIES } from '@eco/shared';
import { eq } from 'drizzle-orm';

async function seed() {
  const db = getDb();

  console.log('Seeding municipalities...');
  for (const m of MUNICIPALITIES) {
    await db
      .insert(municipalities)
      .values({
        name: m.name,
        slug: m.slug,
        region: m.region,
        latitude: m.latitude,
        longitude: m.longitude,
        population: m.population,
      })
      .onConflictDoNothing({ target: municipalities.slug });
  }
  console.log(`  -> ${MUNICIPALITIES.length} municipalities seeded`);

  const agencyConfigs = [
    {
      name: 'Autoridad de Acueductos y Alcantarillados',
      slug: 'aaa',
      brandwatchProjectId: 1998403803,
      brandwatchQueryIds: [2003911540],
    },
    {
      name: 'Departamento de Desarrollo Económico y Comercio',
      slug: 'ddecpr',
      brandwatchProjectId: 1998405210,
      brandwatchQueryIds: [2003921640, 2003930254, 2003930261, 2003930255],
    },
  ];

  for (const cfg of agencyConfigs) {
    console.log(`Seeding agency: ${cfg.slug}...`);
    await db
      .insert(agencies)
      .values(cfg)
      .onConflictDoNothing({ target: agencies.slug });

    const [agency] = await db
      .select({ id: agencies.id })
      .from(agencies)
      .where(eq(agencies.slug, cfg.slug));

    if (!agency) {
      console.error(`  -> Failed to find agency ${cfg.slug}`);
      continue;
    }

    const agencyTopics = TOPICS_BY_AGENCY[cfg.slug] ?? [];
    for (const t of agencyTopics) {
      const [inserted] = await db
        .insert(topics)
        .values({
          agencyId: agency.id,
          name: t.name,
          slug: t.slug,
          description: t.description,
          displayOrder: t.displayOrder,
        })
        .onConflictDoNothing()
        .returning({ id: topics.id });

      if (inserted) {
        for (const s of t.subtopics) {
          await db
            .insert(subtopics)
            .values({
              topicId: inserted.id,
              name: s.name,
              slug: s.slug,
              description: s.description,
              displayOrder: s.displayOrder,
            })
            .onConflictDoNothing();
        }
      }
    }
    const totalSubs = agencyTopics.reduce((sum, t) => sum + t.subtopics.length, 0);
    console.log(`  -> ${agencyTopics.length} topics, ${totalSubs} subtopics seeded for ${cfg.slug}`);
  }

  console.log('Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
