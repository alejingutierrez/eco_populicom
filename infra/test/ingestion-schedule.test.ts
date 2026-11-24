import {
  BIQ_INGESTION_CRON,
  ECO_INGESTION_CRON,
  cronMinutes,
  minGapMinutes,
} from '../lib/ingestion-schedule';

describe('crons escalonados de ingesta (ING-01, WP-4)', () => {
  test('ECO corre en los minutos 0, 5, 10… y BrandIQ en los 2, 7, 12…', () => {
    expect(cronMinutes(ECO_INGESTION_CRON)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(cronMinutes(BIQ_INGESTION_CRON)).toEqual([2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57]);
  });

  test('los dos siguen siendo cada 5 min: 12 corridas por hora', () => {
    expect(cronMinutes(ECO_INGESTION_CRON)).toHaveLength(12);
    expect(cronMinutes(BIQ_INGESTION_CRON)).toHaveLength(12);
  });

  test('nunca arrancan a menos de 2 minutos uno del otro', () => {
    const gap = minGapMinutes(cronMinutes(ECO_INGESTION_CRON), cronMinutes(BIQ_INGESTION_CRON));
    expect(gap).toBe(2);
  });

  test('minGapMinutes mide en círculo sobre la hora', () => {
    expect(minGapMinutes([0], [59])).toBe(1);
    expect(minGapMinutes([0, 30], [0])).toBe(0);
  });

  test('una expresión que no es «desde A cada B» se rechaza', () => {
    expect(() => cronMinutes('rate(5 minutes)')).toThrow();
    expect(() => cronMinutes('cron(0 7 * * ? *)')).toThrow();
  });
});
