import { describe, it, expect } from 'vitest';
import { getDefaults } from '../../../src/settings';

describe('runSurface setting', () => {
  it('defaults to adaptive', () => {
    expect(getDefaults().skills.runSurface).toBe('adaptive');
  });
});
