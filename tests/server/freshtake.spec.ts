import { describe, expect, it } from 'vitest';
import {
	COUNTIES,
	freshTakeFeed,
	parseFreshTake,
	parseFreshTakeRaces
} from '../../src/lib/server/freshtake.ts';
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
		expect(next.counties[0].early).toMatchObject({
			npa: 6_000,
			oth: 2_000,
			total: ala.early.total
		});
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

describe('drop guard timing', () => {
	const base = () => freshTakeFeed(parseFreshTake(page(all())));
	const at = (feed: ReturnType<typeof base>, minutes: number, early: number) => {
		const next = structuredClone(feed);
		next.fetchedAt = new Date(Date.parse('2026-11-03T15:00:00Z') + minutes * 60_000).toISOString();
		const bro = next.counties.find((c) => c.code === 'BRO')!;
		const cut = bro.early.total - early;
		bro.early = { ...bro.early, rep: bro.early.rep - cut, total: early };
		next.early = { ...next.early, rep: next.early.rep - cut, total: next.early.total - cut };
		return next;
	};
	const broEarly = (f: ReturnType<typeof base>) =>
		f.counties.find((c) => c.code === 'BRO')!.early.total;

	it('holds a partial drop for 15 minutes, then accepts it as a correction', () => {
		let feed = base();
		const full = broEarly(feed);
		const lower = full - 10_000;
		feed = reconcileCounties(at(feed, 0, lower), feed);
		expect(broEarly(feed)).toBe(full);
		feed = reconcileCounties(at(feed, 14, lower), feed);
		expect(broEarly(feed)).toBe(full);
		feed = reconcileCounties(at(feed, 15, lower), feed);
		expect(broEarly(feed)).toBe(lower);
		expect(feed.counties.find((c) => c.code === 'BRO')!.heldSince).toBeUndefined();
	});

	it('never accepts a drop to zero, and takes the real numbers back as soon as they return', () => {
		let feed = base();
		const full = broEarly(feed);
		for (const minutes of [0, 30, 90]) {
			feed = reconcileCounties(at(feed, minutes, 0), feed);
			expect(broEarly(feed)).toBe(full);
		}
		feed = reconcileCounties(at(feed, 95, full + 500), feed);
		expect(broEarly(feed)).toBe(full + 500);
		expect(feed.counties.find((c) => c.code === 'BRO')!.heldSince).toBeUndefined();
		expect(feed.early.total).toBe(feed.counties.reduce((n, c) => n + c.early.total, 0));
	});
});

describe('FreshTake statewide race totals', () => {
	const card = (title: string, rows: string) => `<div class="card">
		<p class="card__title">${title}</p>
		<p class="race-precincts"><span>Precincts Reporting: 544 / 4,648</span></p>
		<div class="race-candidates">${rows}</div>
		<p class="footnote race-footnote">Source: <i>62 counties, via each County Supervisor of Elections</i></p>
	</div>`;
	const row = (name: string, votes: string) => `<div class="race-candidate-row">
		<div class="race-candidate-name" title="${name}">x</div>
		<div class="race-bar-label">${votes} &middot; 53.79%</div></div>`;

	it('reads statewide races, candidates and precincts, skipping other cards', () => {
		const html =
			card(
				'Florida Governor',
				row('David Jolly / Gwen Graham (DEM)', '2,422,938') +
					row('Byron Donalds / Bryan Avila (REP)', '2,081,125')
			) +
			card('U.S. Senator', row('Ashley Moody (REP)', '2,028,031')) +
			card('2026 General: Statewide Voter Turnout', '');
		const races = parseFreshTakeRaces(html);
		expect(races.map((r) => r.race)).toEqual(['GOV', 'USS']);
		expect(races[0]).toMatchObject({ reporting: 544, precincts: 4648, counties: 62 });
		expect(races[0].candidates).toEqual([
			{ name: 'David Jolly / Gwen Graham', party: 'DEM', votes: 2422938 },
			{ name: 'Byron Donalds / Bryan Avila', party: 'REP', votes: 2081125 }
		]);
	});
});

describe('race calls', () => {
	it('reads called statewide and House races and skips uncalled ones', async () => {
		const { parseCalls } = await import('../../src/lib/server/calls.ts');
		const cand = (lastName: string, party: string, won: boolean) => ({
			name: `X ${lastName}`,
			lastName,
			party,
			isWinner: won,
			callStatus: won ? 'P' : ''
		});
		const calls = parseCalls({
			stateRaceResults: {
				discreteOffices: [
					{
						officeCode: 'G',
						candidates: [cand('Donalds', 'gop', true), cand('Jolly', 'dem', false)]
					}
				],
				otherRaces: [{ officeCode: 'A', candidates: [cand('Uthmeier', 'gop', false)] }],
				house: [
					{ district: 22, candidates: [cand('Dandiya', 'dem', true), cand('Askar', 'gop', false)] },
					{ district: 13, candidates: [cand('Luna', 'gop', false), cand('Gray', 'dem', false)] }
				]
			}
		});
		expect(calls.races).toEqual({
			GOV: { name: 'X Donalds', lastName: 'Donalds', party: 'REP' },
			'USR-22': { name: 'X Dandiya', lastName: 'Dandiya', party: 'DEM' }
		});
		expect(() => parseCalls({})).toThrow();
	});
});
