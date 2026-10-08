import { describe, expect, it } from 'vitest';
import { plural, ru } from './ru';

describe('plural', () => {
  it('picks the Russian form', () => {
    const f = (n: number) => plural(n, 'попытка', 'попытки', 'попыток');
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111].map(f)).toEqual([
      'попытка',
      'попытки',
      'попытки',
      'попыток',
      'попыток',
      'попыток',
      'попыток',
      'попытка',
      'попытки',
      'попыток',
      'попыток',
    ]);
    expect(ru.auth.codeWrong(4)).toBe('Код не подошёл. Осталось 4 попытки.');
  });
});
