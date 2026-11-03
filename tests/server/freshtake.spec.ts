import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/feed.json';
import { parseFreshTake } from '../../src/lib/server/freshtake.ts';
import { fillMissingEday } from '../../src/lib/live.ts';
import { ZERO } from '../../src/lib/election.ts';
import type { FeedData } from '../../src/lib/types.ts';

const html = `<script>
(function () {
    var COUNTY_METHODS = {"Lake":{"voters":283780,"mail":{"rep":1,"dem":2,"oth":3},"early":{"rep":4,"dem":5,"oth":6},"eday":{"rep":3262,"dem":1219,"oth":1282}},"St. Johns":{"voters":10,"eday":{"rep":5,"dem":4,"oth":1}}};
})();
</script>
<p class="footnote">Last updated: 2026-11-03 08:37:02</p>
<p class="footnote">Last updated: 2026-11-03 08:38:12</p>`;

describe('FreshTake fallback', () => {
	it('reads Election Day by county and the latest update time', () => {
		const parsed = parseFreshTake(html);
		expect(parsed.counties.get('lake')).toEqual({
			rep: 3262,
			dem: 1219,
			npa: 1282,
			oth: 0,
			total: 5763
		});
		expect(parsed.counties.get('stjohns')?.total).toBe(10);
		expect(parsed.updated).toBe('2026-11-03T13:38:12.000Z');
		expect(() => parseFreshTake('<html></html>')).toThrow();
	});

	it('fills only counties the main source reports at zero and keeps statewide totals in step', () => {
		const data = structuredClone(fixture) as unknown as FeedData;
		data.counties = data.counties.map((c) => ({
			...c,
			eday: c.eday ?? { ...ZERO, rep: 10, total: 10 }
		}));
		const lake = data.counties.find((c) => c.name === 'Lake')!;
		lake.eday = { ...ZERO };
		const other = data.counties.find((c) => c.name !== 'Lake')!;
		other.eday = { ...ZERO, rep: 40, dem: 30, total: 70 };
		data.eday = data.counties.reduce(
			(sum, c) => ({
				rep: sum.rep + c.eday!.rep,
				dem: sum.dem + c.eday!.dem,
				npa: sum.npa + c.eday!.npa,
				oth: sum.oth + c.eday!.oth,
				total: sum.total + c.eday!.total
			}),
			{ ...ZERO }
		);
		const parsed = parseFreshTake(html);
		parsed.counties.delete('stjohns');
		parsed.counties.set(other.name.toLowerCase().replace(/[^a-z]/g, ''), {
			...ZERO,
			rep: 999_999,
			total: 999_999
		});
		const filled = fillMissingEday(data, parsed, 'FreshTake');
		const after = filled.counties.find((c) => c.name === 'Lake')!;
		expect(after.eday?.total).toBe(5763);
		expect(after.edaySource).toBe('FreshTake');
		expect(after.updated).toBe(parsed.updated);
		expect(filled.counties.find((c) => c.name === other.name)!.eday).toEqual(other.eday);
		expect(filled.eday!.total).toBe(data.eday.total + 5763);
		expect(filled.eday!.rep).toBe(data.eday.rep + 3262);
	});
});
