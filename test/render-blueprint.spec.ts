import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the "always free" promise: render.yaml may only describe free resources. Any paid plan, extra
 * database, worker, Redis or disk would start billing the moment the Blueprint syncs, so it fails here.
 */
describe('render.yaml stays on free plans', () => {
  const yaml = readFileSync(join(__dirname, '..', 'render.yaml'), 'utf8');
  const lines = yaml.split('\n').filter((l) => !l.trim().startsWith('#'));

  it('has exactly one web service', () => {
    const types = lines
      .filter((l) => /^\s*-?\s*type:\s/.test(l))
      .map((l) => l.split('type:')[1]!.trim());
    expect(
      types.filter((t) => !['web', 'static'].includes(t) && t !== 'rewrite' && t !== 'header'),
    ).toEqual([]);
    expect(types.filter((t) => t === 'web').length).toBe(1);
  });

  it('every plan is free', () => {
    const plans = lines
      .filter((l) => /^\s*plan:\s/.test(l))
      .map((l) => l.split('plan:')[1]!.trim());
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((p) => p === 'free')).toBe(true);
  });

  it('declares nothing that bills separately', () => {
    for (const word of [
      'databases:',
      'disk:',
      'keyvalue',
      'redis',
      'pserv',
      'worker',
      'cron',
      'numInstances',
      'autoscaling',
    ]) {
      expect(lines.some((l) => l.includes(word))).toBe(false);
    }
  });
});
