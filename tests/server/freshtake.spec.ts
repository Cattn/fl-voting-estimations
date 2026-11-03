import { describe, expect, it } from 'vitest';
import { COUNTIES, freshTakeFeed, parseFreshTake } from '../../src/lib/server/freshtake.ts';
import { reconcileCounties } from '../../src/lib/live.ts';
import { ZERO } from '../../src/lib/election.ts';

const row = (i: number) => ({
	voters: 100_000 + i,
	mail: { rep: 10_000 + i, dem: 20_000, oth: 5_000 },
	early: { rep: 30_000, dem: 10_000 + i, oth: 8_000 },
	eday: { rep: 4_000, dem: 2_000, oth: 1_000 + i }
});
const page = (rows: Record<string, unknown>) => `<script>
(function () {
    var COUNTY_METHODS = ${JSON.stringify(rows)};
})();
</script>
<p class="footnote">Last updated: 2026-11-03 08:37:02</p>
<p class="footnote">Last updated: 2026-11-03 08:38:12</p>`;
const all = () => Object.fromEntries(COUNTIES.map(([, name], i) => [name, row(i)]));

describe('FreshTake turnout source', () => {
	it('reads every method, registration and the latest update time', () => {
		const parsed = parseFreshTake(
			page({
				Lake: {
					voters: 283780,
					mail: { rep: 1, dem: 2, oth: 3 },
					early: { rep: 4, dem: 5, oth: 6 },
					eday: { rep: 3262, dem: 1219, oth: 1282 }
				}
			})
		);
		const lake = parsed.counties.get('lake')!;
		expect(lake.registered).toBe(283780);
		expect(lake.eday).toEqual({ rep: 3262, dem: 1219, npa: 1282, oth: 0, total: 5763 });
		expect(lake.early.total).toBe(15);
		expect(parsed.updated).toBe('2026-11-03T13:38:12.000Z');
		expect(() => parseFreshTake('<html></html>')).toThrow();
	});

	it('builds a full feed whose statewide totals add up from the counties', () => {
		const feed = freshTakeFeed(parseFreshTake(page(all())));
		expect(feed.counties).toHaveLength(67);
		expect(feed.counties.every((c) => c.registered > 0 && c.status === 'live')).toBe(true);
		for (const m of ['early', 'mail', 'eday'] as const)
			expect(feed[m]!.total).toBe(feed.counties.reduce((n, c) => n + c[m]!.total, 0));
		expect(feed.fetchedAt).toBe('2026-11-03T13:38:12.000Z');
		const rows = all();
		delete rows['St. Johns'];
		expect(() => freshTakeFeed(parseFreshTake(page(rows)))).toThrow(/St\. Johns/);
	});

	it('splits combined other voters like the previous feed and keeps unchanged report times', () => {
		const first = freshTakeFeed(parseFreshTake(page(all())));
		const previous = structuredClone(first);
		const ala = previous.counties[0];
		ala.early = { ...ala.early, npa: 6_000, oth: 2_000 };
		ala.updated = '2026-11-03T12:00:00.000Z';
		const next = freshTakeFeed(parseFreshTake(page(all())), previous);
		expect(next.counties[0].early).toMatchObject({ npa: 6_000, oth: 2_000, total: ala.early.total });
		expect(next.counties[0].updated).toBe('2026-11-03T12:00:00.000Z');
	});

	it('keeps a county’s last counts when a source suddenly drops them', () => {
		const previous = freshTakeFeed(parseFreshTake(page(all())));
		const incoming = structuredClone(previous);
		const bro = incoming.counties.find((c) => c.code === 'BRO')!;
		const kept = previous.counties.find((c) => c.code === 'BRO')!;
		incoming.early = { ...incoming.early, total: incoming.early.total - bro.early.total };
		incoming.early.rep -= bro.early.rep;
		incoming.early.dem -= bro.early.dem;
		incoming.early.npa -= bro.early.npa;
		incoming.early.oth -= bro.early.oth;
		bro.early = { ...ZERO };
		const fixed = reconcileCounties(incoming, previous);
		expect(fixed.counties.find((c) => c.code === 'BRO')!.early).toEqual(kept.early);
		expect(fixed.early).toEqual(previous.early);
		const small = structuredClone(previous);
		small.counties[0].mail = { ...small.counties[0].mail, rep: small.counties[0].mail.rep - 1 };
		small.counties[0].mail.total -= 1;
		expect(reconcileCounties(small, previous).counties[0].mail.total).toBe(
			previous.counties[0].mail.total - 1
		);
	});
});
