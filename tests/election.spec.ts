import { describe, expect, it } from 'vitest';
import {
	addCounts,
	dayShare,
	dayPaths,
	edOutcome,
	halfHourRows,
	lateMailRemaining,
	localMinute,
	liveTurnout,
	minuteOfDay,
	notYetVoted,
	POLLS_CLOSE,
	POLLS_OPEN,
	PRESETS,
	presetTurnout,
	RESULTS_START,
	scaleCounts,
	turnoutEstimates,
	ZERO
} from '../src/lib/election.ts';
import { marginOf } from '../src/lib/model.ts';
import {
	closestDistricts,
	districtResults,
	parseResults,
	projectRace,
	raceMargin,
	tallyRaces
} from '../src/lib/results.ts';
import { parsePreview, sampleElection } from './fixtures/sample.ts';
import type { EdState } from '../src/lib/election.ts';
import type { FeedData, PartyCounts } from '../src/lib/types.ts';

const counts = (rep: number, dem: number, npa: number): PartyCounts => ({
	rep,
	dem,
	npa,
	oth: 0,
	total: rep + dem + npa
});

const counties = [
	{
		code: 'BAY',
		name: 'Bay',
		registered: 3_000_000,
		early: counts(600_000, 250_000, 150_000),
		mail: counts(150_000, 150_000, 100_000)
	},
	{
		code: 'ORA',
		name: 'Orange',
		registered: 4_000_000,
		early: counts(300_000, 500_000, 200_000),
		mail: counts(100_000, 300_000, 100_000)
	},
	{
		code: 'DAD',
		name: 'Miami-Dade',
		registered: 6_690_000,
		early: counts(600_000, 400_000, 400_000),
		mail: counts(400_000, 350_000, 220_000)
	}
];

const feed: FeedData = {
	source: 'sample',
	fetchedAt: '2026-10-28T18:00:00Z',
	windowOpen: true,
	registered: 13_690_000,
	early: addCounts(...counties.map((c) => c.early)),
	mail: addCounts(...counties.map((c) => c.mail)),
	outstanding: ZERO,
	counties,
	earlyDays: [{ date: '2026-10-27', ...addCounts(...counties.map((c) => c.early)) }],
	mailDays: []
};

describe('Election Day preview', () => {
	it('keeps explicit phases in their time ranges and rejects invalid clocks', () => {
		const preview = (query: string) => parsePreview(new URLSearchParams(query));
		expect(preview('phase=pre&at=15:10')).toBe(-530);
		expect(preview('phase=open&at=14:30')).toBe(870);
		expect(preview('phase=closed&at=22:15')).toBe(1335);
		expect(preview('phase=open&at=23:59')).toBeLessThan(RESULTS_START);
		expect(preview('phase=closed&at=10:00')).toBe(RESULTS_START);
		expect(preview('phase=open&at=00:00')).toBe(POLLS_OPEN);
		expect(preview('phase=closed&at=99:99')).toBe(1335);
		expect(preview('at=19:60')).toBe(870);
	});

	it('has no Election Day votes or candidate results before opening', () => {
		const sample = sampleElection(feed, -530);
		expect(sample.state.phase).toBe('pre');
		expect(sample.state.eday.total).toBe(0);
		expect(sample.state.history).toEqual([]);
		expect(sample.results.every((r) => r.votes === 0 && r.reporting === 0)).toBe(true);
		expect(closestDistricts(districtResults(tallyRaces(sample.results), 0))).toEqual([]);
	});

	it('waits for central-time counties and keeps all aggregate totals consistent', () => {
		const open = sampleElection(feed, POLLS_OPEN + 45);
		expect(open.state.counties.find((c) => c.code === 'BAY')!.eday!.total).toBe(0);
		for (const minute of [POLLS_OPEN, 870, POLLS_CLOSE + 30, 1430]) {
			const { state, results } = sampleElection(feed, minute);
			expect(state.eday).toEqual(addCounts(...state.counties.map((c) => c.eday!)));
			expect(state.mail).toEqual(addCounts(...state.counties.map((c) => c.mail)));
			for (const c of state.counties) {
				expect(c.eday!.total).toBe(c.eday!.rep + c.eday!.dem + c.eday!.npa + c.eday!.oth);
			}
			expect(results.every((r) => r.votes >= 0 && Number.isInteger(r.votes))).toBe(true);
			if (minute < RESULTS_START) expect(results.every((r) => r.votes === 0)).toBe(true);
		}
	});

	it('finishes with actual turnout for every preset and no remaining mail', () => {
		const { state, results } = sampleElection(feed, 1430);
		const total = addCounts(state.early, state.mail, state.eday);
		expect(liveTurnout(state)).toEqual({ turnout: state.eday, weight: 1 });
		expect(lateMailRemaining(state).total).toBe(0);
		for (const preset of PRESETS) {
			const outcome = edOutcome(state, presetTurnout(state, preset.id), -8.5);
			expect(outcome.turnout).toEqual(state.eday);
			expect(outcome.rest.total).toBe(0);
			expect(outcome.needed).toBeNull();
			expect(outcome.final.margin).toBeCloseTo(marginOf(total));
		}
		expect(results.every((r) => r.reporting === r.precincts)).toBe(true);
	});
});

describe('Election Day forecasts', () => {
	it('uses observed county pace for Live instead of a selected turnout scenario', () => {
		const state = sampleElection(feed, 870).state;
		const expected = addCounts(
			...state.counties.map((c) =>
				scaleCounts(c.eday!, 1 / dayShare(localMinute(c.code, minuteOfDay(c.updated!))))
			)
		);
		const live = liveTurnout(state);
		expect(live.turnout.rep).toBeCloseTo(expected.rep, 6);
		expect(live.turnout.dem).toBeCloseTo(expected.dem, 6);
		expect(live.turnout.npa).toBeCloseTo(expected.npa + expected.oth, 6);
		expect(live.turnout).not.toEqual(presetTurnout(state, 'middle'));
		for (const preset of PRESETS) {
			presetTurnout(state, preset.id);
			expect(liveTurnout(state)).toEqual(live);
		}
	});

	it('uses the same starting assumption when Live has no usable turnout reports', () => {
		const state = sampleElection(feed, POLLS_OPEN).state;
		expect(liveTurnout(state).turnout).toEqual(presetTurnout(state, 'middle'));
		expect(liveTurnout(state).weight).toBe(0);
		const later = sampleElection(feed, 870).state;
		const withoutTimes = structuredClone(later);
		for (const c of withoutTimes.counties) delete c.updated;
		expect(liveTurnout(withoutTimes).turnout.total).toBeGreaterThanOrEqual(withoutTimes.eday.total);
		expect(Number.isFinite(liveTurnout(withoutTimes).turnout.total)).toBe(true);
	});

	const spread = (state: EdState) => {
		const margins = turnoutEstimates(state).presets.map(
			(p) => edOutcome(state, p.turnout, -8.5).final.margin
		);
		return Math.max(...margins) - Math.min(...margins);
	};

	it('narrows well before closing as fresh, consistent reports accumulate', () => {
		const before = sampleElection(feed, -530).state;
		const noon = sampleElection(feed, 720).state;
		const afternoon = sampleElection(feed, 1020).state;
		const evening = sampleElection(feed, 1110).state;
		expect(spread(noon)).toBeLessThan(spread(before) * 0.65);
		expect(spread(afternoon)).toBeLessThan(spread(before) * 0.2);
		expect(spread(evening)).toBeLessThan(spread(afternoon));
		expect(spread(evening)).toBeGreaterThan(0);
	});

	it('widens again and moves the estimate when the recent party turnout pattern breaks', () => {
		const steady = sampleElection(feed, 1020).state;
		const changed = structuredClone(steady);
		for (const c of changed.counties) {
			c.eday!.dem *= 1.35;
			c.eday!.total = c.eday!.rep + c.eday!.dem + c.eday!.npa + c.eday!.oth;
		}
		changed.eday = addCounts(...changed.counties.map((c) => c.eday!));
		const earlier = turnoutEstimates(steady);
		const later = turnoutEstimates(changed);
		expect(later.instability).toBeGreaterThan(earlier.instability);
		expect(spread(changed)).toBeGreaterThan(spread(steady) * 2);
		expect(edOutcome(changed, later.live.turnout, -8.5).final.margin).toBeGreaterThan(
			edOutcome(steady, earlier.live.turnout, -8.5).final.margin
		);
	});

	it('keeps a wider spread when a large county has not reported', () => {
		const complete = sampleElection(feed, 1020).state;
		const missing = structuredClone(complete);
		missing.counties.find((c) => c.code === 'DAD')!.eday = ZERO;
		missing.eday = addCounts(...missing.counties.map((c) => c.eday!));
		for (const h of missing.history) {
			h.counties!.find((c) => c.code === 'DAD')!.eday = ZERO;
			h.eday = addCounts(...h.counties!.map((c) => c.eday!));
		}
		expect(turnoutEstimates(missing).coverage).toBeLessThan(turnoutEstimates(complete).coverage);
		expect(spread(missing)).toBeGreaterThan(spread(complete) * 2);
	});

	it('does not become more confident when the clock advances without fresh counts', () => {
		const fresh = sampleElection(feed, 870).state;
		const stale = { ...fresh, minute: 1020 };
		expect(turnoutEstimates(stale).live.weight).toBeLessThan(turnoutEstimates(fresh).live.weight);
		expect(spread(stale)).toBeGreaterThanOrEqual(spread(fresh));
		const previousDay = structuredClone(fresh);
		for (const c of previousDay.counties) c.updated = '2026-11-02T19:30:00Z';
		expect(turnoutEstimates(previousDay).live.weight).toBe(0);
		const invalidTime = structuredClone(fresh);
		for (const c of invalidTime.counties) c.updated = 'invalid';
		expect(turnoutEstimates(invalidTime).live.weight).toBeLessThan(
			turnoutEstimates(fresh).live.weight
		);
		expect(Number.isFinite(spread(invalidTime))).toBe(true);
	});

	it('preserves uncertainty with limited history and never forecasts outside the remaining electorate', () => {
		const state = sampleElection(feed, 1020).state;
		const sparse = { ...state, history: state.history.slice(-1) };
		expect(spread(sparse)).toBeGreaterThan(spread(state));
		const pool = notYetVoted(state);
		for (const { turnout } of turnoutEstimates(state).presets) {
			expect(turnout.rep).toBeGreaterThanOrEqual(state.eday.rep);
			expect(turnout.dem).toBeGreaterThanOrEqual(state.eday.dem);
			expect(turnout.rep).toBeLessThanOrEqual(pool.rep);
			expect(turnout.dem).toBeLessThanOrEqual(pool.dem);
			expect(turnout.npa + turnout.oth).toBeLessThanOrEqual(pool.oth);
		}
		expect(spread({ ...state, counties: [] })).toBeGreaterThan(spread(state));
	});

	it('lets Central-time counties continue after eastern polls close', () => {
		const state = sampleElection(feed, POLLS_CLOSE).state;
		const only = (code: string): EdState => {
			const county = {
				...state.counties.find((c) => c.code === code)!,
				updated: '2026-11-04T00:00:00Z'
			};
			return { ...state, counties: [county], eday: county.eday!, history: [] };
		};
		const central = only('BAY');
		const eastern = only('ORA');
		expect(turnoutEstimates(central).live.turnout.total).toBeGreaterThan(central.eday.total);
		expect(turnoutEstimates(eastern).live.turnout.total).toBe(eastern.eday.total);
		expect(dayShare(POLLS_CLOSE)).toBe(1);
		const outcome = edOutcome(central, turnoutEstimates(central).live.turnout, -8.5);
		const path = dayPaths(central, outcome).live;
		expect(path.at(-2)!.margin).not.toBe(path.at(-1)!.margin);
	});

	it('centers the preset band on a Republican turnout advantage while preserving favorable Democratic scenarios', () => {
		const { state } = sampleElection(feed, -530);
		const margins = PRESETS.map(
			(p) => edOutcome(state, presetTurnout(state, p.id), -8.5).final.margin
		);
		for (let i = 1; i < margins.length; i++) expect(margins[i]).toBeGreaterThan(margins[i - 1]);
		expect(margins[2]).toBeLessThan(-10);
		expect(margins[2]).toBeGreaterThan(-14);
		expect(margins.at(-1)).toBeLessThan(0);
		const final = sampleElection(feed, 1430).state;
		expect(marginOf(addCounts(final.early, final.mail, final.eday))).toBeCloseTo(margins[2], 1);
	});

	it('changes only the needed margin when the target moves and ends the chart on that target', () => {
		for (const minute of [870, 1110, 1170]) {
			const { state } = sampleElection(feed, minute);
			const turnout = liveTurnout(state).turnout;
			const baseline = edOutcome(state, turnout, -8.5).final.margin;
			const first = edOutcome(state, turnout, baseline);
			const second = edOutcome(state, turnout, baseline + 0.1);
			expect(first.final).toEqual(second.final);
			expect(second.needed).toBeGreaterThan(first.needed!);
			const lines = dayPaths(state, second);
			expect(lines.path.at(-1)!.margin).toBeCloseTo(baseline + 0.1, 7);
			expect(lines.live.at(-1)!.margin).toBeCloseTo(second.final.margin, 7);
			expect(lines.path[0]).toEqual(lines.reported.at(-1));
		}
	});

	it('does not draw a path to an unreachable target late in the day', () => {
		const { state } = sampleElection(feed, 1170);
		const outcome = edOutcome(state, liveTurnout(state).turnout, 50);
		expect(outcome.needed).toBeGreaterThan(100);
		expect(dayPaths(state, outcome).path).toEqual([]);
		expect(dayPaths(state, outcome).live.at(-1)!.margin).toBeCloseTo(outcome.final.margin);
	});

	it('never projects fewer party votes than already reported and accounts for each interval', () => {
		const { state } = sampleElection(feed, 1170);
		const outcome = edOutcome(state, presetTurnout(state, 'strong-d'), -8.5);
		expect(outcome.turnout.rep).toBeGreaterThanOrEqual(state.eday.rep);
		expect(outcome.turnout.dem).toBeGreaterThanOrEqual(state.eday.dem);
		const rows = halfHourRows(state, outcome.turnout, -8.5);
		expect(addCounts(...rows.map((r) => r.added)).total).toBe(state.eday.total);
		expect(rows[0].minute).toBe(1170);
	});
});

describe('results and closest districts', () => {
	it('parses candidate votes separately from registration and tallies precincts once per county', () => {
		const text = [
			'PartyCode\tRaceCode\tRaceName\tCountyCode\tPrecincts\tPrecinctsReporting\tCanNameLast\tCanNameFirst\tCanVotes',
			'REP\tUSR\tRepresentative in Congress, District 4\tBAY\t10\t5\tRepublican\tAlex\t500',
			'DEM\tUSR\tRepresentative in Congress, District 4\tBAY\t10\t5\tDemocrat\tSam\t450',
			'NPA\tUSR\tRepresentative in Congress, District 4\tBAY\t10\t5\tOther\tLee\t50'
		].join('\n');
		const [race] = tallyRaces(parseResults(text));
		expect(race.total).toBe(1000);
		expect(race.precincts).toBe(10);
		expect(race.reporting).toBe(5);
		expect(raceMargin(race)).toBe(-5);
		expect(race.candidates[0].name).toBe('Republican');
	});

	it('matches the statewide result when all ballots are counted', () => {
		const { state, results } = sampleElection(feed, 1430);
		const race = tallyRaces(results).find((r) => r.race === 'GOV')!;
		const all = addCounts(state.early, state.mail, state.eday);
		const projection = projectRace(state.counties, race, all.total, marginOf(all));
		expect(projection.counted).toBeCloseTo(1, 5);
		expect(projection.projected).toBeCloseTo(raceMargin(race), 3);
	});

	it('ranks current margins early, projected margins later, and excludes unreported districts', () => {
		const { results } = sampleElection(feed, 1335);
		const rows = districtResults(tallyRaces(results), -8);
		const [first, second, third] = rows;
		first.margin = 0.1;
		first.projected = 20;
		first.counted = 0.1;
		second.margin = 2;
		second.projected = 0.2;
		second.counted = 0.8;
		third.race = null;
		expect(closestDistricts([first, second, third]).map((r) => r.district.n)).toEqual([1, 2]);
		first.counted = 0.8;
		expect(closestDistricts([first, second, third]).map((r) => r.district.n)).toEqual([2, 1]);
		const final = districtResults(tallyRaces(sampleElection(feed, 1430).results), -8);
		expect(
			final.filter((r) => r.race).every((r) => r.projected === r.margin && r.range === 0.5)
		).toBe(true);
	});
});
