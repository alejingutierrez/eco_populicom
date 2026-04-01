import { getDb } from '../client.js';
import { agencies, topics, subtopics, municipalities } from '../schema/index.js';
import { TOPICS } from '@eco/shared';
import { MUNICIPALITIES } from '@eco/shared';

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

  console.log('Seeding topics and subtopics...');
  for (const t of TOPICS) {
    const [inserted] = await db
      .insert(topics)
      .values({
        name: t.name,
        slug: t.slug,
        description: t.description,
        displayOrder: t.displayOrder,
      })
      .onConflictDoNothing({ target: topics.slug })
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
  const totalSubtopics = TOPICS.reduce((sum, t) => sum + t.subtopics.length, 0);
  console.log(`  -> ${TOPICS.length} topics, ${totalSubtopics} subtopics seeded`);

  console.log('Seeding AAA agency...');
  await db
    .insert(agencies)
    .values({
      name: 'Autoridad de Acueductos y Alcantarillados',
      slug: 'aaa',
      brandwatchProjectId: 1998403803,
      brandwatchQueryIds: [2003911540],
    })
    .onConflictDoNothing({ target: agencies.slug });
  console.log('  -> AAA agency seeded');

  console.log('Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
