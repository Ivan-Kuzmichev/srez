import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { largestSector, sectorAllocation } from './sectors';

const D = (v: string | number) => new Decimal(v);

describe('эталон 16.1: отрасли от акций и фондов', () => {
  const items = [
    { sector: 'it', value: D(500) },
    { sector: 'it', value: D(118) },
    { sector: 'financial', value: D(172) },
    { sector: 'energy', value: D(94) },
    { sector: 'materials', value: D(61) },
    { sector: 'consumer', value: D(55) },
  ];
  const targets = new Map([
    ['it', D(40)],
    ['financial', D(25)],
    ['energy', D(15)],
    ['materials', D(10)],
    ['consumer', D(10)],
  ]);

  it('shares, the targets beyond 5 p.p., and what reaches each target', () => {
    const { base, rows } = sectorAllocation(items, targets, D(5));
    expect(base.toFixed()).toBe('1000');
    expect(rows.map((r) => [r.sector, r.share.toFixed(1), r.offTarget, r.move!.toFixed()])).toEqual([
      ['it', '61.8', true, '-218'],
      ['financial', '17.2', true, '78'],
      ['energy', '9.4', true, '56'],
      ['materials', '6.1', false, '39'],
      ['consumer', '5.5', false, '45'],
    ]);
  });

  it('a target with nothing held shows up; the unknown sector goes last without a target', () => {
    const { rows } = sectorAllocation(
      [
        { sector: '', value: D(100) },
        { sector: 'it', value: D(300) },
      ],
      new Map([['telecom', D(20)]]),
      D(5),
    );
    expect(
      rows.map((r) => [r.sector, r.share.toFixed(), r.target?.toFixed() ?? null, r.move?.toFixed() ?? null]),
    ).toEqual([
      ['it', '75', null, null],
      ['telecom', '0', '20', '80'],
      ['', '25', null, null],
    ]);
  });

  it('the largest known sector for the limit, of everything held', () => {
    expect(largestSector(items)).toEqual({ sector: 'it', share: D('61.8') });
    expect(largestSector([{ sector: '', value: D(5) }])).toBeNull();
  });
});
