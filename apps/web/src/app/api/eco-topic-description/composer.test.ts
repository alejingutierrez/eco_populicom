import { COMPOSER_VERSION } from '@eco/shared';
import { composerVersionFromModelUsed } from './composer';

describe('versión del motor en model_used (topic_descriptions_cache)', () => {
  it('legacy → null; motor → su versión; conserva el sufijo del universo primario', () => {
    expect(composerVersionFromModelUsed('us.anthropic.claude-opus-4-6-v1+primary')).toBeNull();
    expect(composerVersionFromModelUsed(null)).toBeNull();
    expect(composerVersionFromModelUsed(`${COMPOSER_VERSION} · us.anthropic.claude-sonnet-4-6+primary`)).toBe(COMPOSER_VERSION);
  });
});
