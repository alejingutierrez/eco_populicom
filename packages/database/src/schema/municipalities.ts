import { pgTable, serial, varchar, doublePrecision, integer } from 'drizzle-orm/pg-core';

export const municipalities = pgTable('municipalities', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  region: varchar('region', { length: 50 }).notNull(),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  population: integer('population').notNull().default(0),
});
