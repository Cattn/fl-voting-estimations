import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/feed.json';
import { electionClock, electionHome, ELECTION_MIDNIGHT } from '../src/lib/election-clock.ts';
import {
	observations,
	reconcileCounties,
	turnoutIsFinal,
	type ElectionSnapshot
} from '../src/lib/live.ts';
import { SIMULATIONS, simulateElection } from './fixtures/simulation.ts';
import { emptyRecord } from './fixtures/record.ts';
import { viewElection } from '../src/lib/view-election.ts';
import { load } from '../src/routes/+layout.server.ts';
import { validateTurnout, parseReporting } from '../src/lib/server/election-sources.ts';
import { parseResults } from '../src/lib/results.ts';
import { addCounts, liveTurnout } from '../src/lib/election.ts';
import type { FeedData } from '../src/lib/types.ts';

const at = new Date('2026-11-03T22:15:00-05:00');
const snapshot = (): ElectionSnapshot => {
	const election = simulateElection(fixture, 'closed', at);
	return {
		at: +at,
		data: {
			...fixture,
			fetchedAt: at.toISOString(),
			counties: election.state.counties,
			early: election.state.early,
			mail: election.state.mail,
			eday: election.state.eday
		},
		election
	};
};

describe('election calendar', () => {
	it('switches after the final EV date across DST and stays closed after midnight', () => {
		expect(electionHome(new Date('2026-11-01T23:59:59-05:00'))).toBeNull();
		expect(electionHome(new Date('2026-11-02T00:00:00-05:00'))).toBe('/election-day');
		expect(electionClock(new Date('2026-11-03T06:59:00-05:00')).phase).toBe('pre');
		expect(electionClock(new Date('2026-11-03T19:59:00-05:00')).phase).toBe('open');
		expect(electionHome(new Date('2026-11-03T20:00:00-05:00'))).toBe('/election-day/state');
		expect(electionClock(new Date('2026-11-04T00:01:00-05:00')).phase).toBe('closed');
	});
	it('ignores old simulation and preview parameters in production', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-10-28T23:00:00Z'));
			const data = load({
				url: new URL('http://localhost/?simulate=closed&phase=closed&at=23:00')
			} as never);
			expect(data).toEqual({ serverClock: electionClock() });
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('live data consistency', () => {
	it('requires completion flags and matching county turnout before marking turnout final', () => {
		const s = snapshot();
		expect(turnoutIsFinal(s, at)).toBe(true);
		s.election.reporting[0].turnout += 100;
		expect(turnoutIsFinal(s, at)).toBe(false);
		s.election.reporting[0].turnout -= 100;
		s.election.reporting[0].mailComplete = false;
		expect(turnoutIsFinal(s, at)).toBe(false);
	});
	it('pauses comparisons for mismatched or stale sources without discarding votes', () => {
		const s = snapshot();
		expect(viewElection(s, at).projectable).toBe(true);
		s.election.sources.turnout.acceptedAt = +at - 21 * 60_000;
		expect(viewElection(s, at).projectable).toBe(false);
		expect(viewElection(s, at).results).toEqual(s.election.results);
		s.election.sources.turnout.acceptedAt = +at;
		s.election.warnings = ['County totals differ'];
		expect(viewElection(s, at).projectable).toBe(false);
	});
	it('keeps a remainder for partial after-close uploads until their completion status reconciles', () => {
		const s = snapshot();
		for (const c of s.data.counties) {
			for (const k of ['rep', 'dem', 'npa', 'oth', 'total'] as const) c.eday![k] *= 0.5;
			c.edayUpdated = at.toISOString();
		}
		s.data.eday = addCounts(...s.data.counties.map((c) => c.eday!));
		const view = viewElection(s, at);
		expect(view.state.turnoutFinal).toBe(false);
		expect(liveTurnout(view.state).turnout.total).toBeGreaterThan(view.state.eday.total);
	});
	it('does not treat a new scrape timestamp as a new county turnout report', () => {
		const old = snapshot().data;
		old.counties[0].edayUpdated = '2026-11-04T01:00:00Z';
		const incoming = structuredClone(old);
		incoming.counties[0].updated = '2026-11-04T02:00:00Z';
		expect(reconcileCounties(incoming, old).counties[0].edayUpdated).toBe('2026-11-04T01:00:00Z');
		incoming.counties[0].eday!.rep -= 10;
		incoming.counties[0].eday!.total -= 10;
		expect(reconcileCounties(incoming, old).counties[0].edayUpdated).toBe('2026-11-04T02:00:00Z');
	});
	it('validates county identities, age and per-party aggregate agreement', () => {
		const feed = snapshot().data;
		expect(validateTurnout(feed, at)).toEqual([]);
		feed.eday!.rep += 100;
		feed.eday!.dem -= 100;
		expect(validateTurnout(feed, at)).toContain(
			'eday statewide and county totals differ; turnout projections are paused.'
		);
		feed.fetchedAt = '2026-11-03T12:00:00Z';
		expect(() => validateTurnout(feed, at)).toThrow('stale');
		feed.counties.pop();
		expect(() => validateTurnout(feed, at)).toThrow('missing counties');
	});
	it('parses county completion flags independently of precinct percentages', () => {
		const feed = snapshot().data;
		const html = `County Reporting Status 2026<table>${feed.counties.map((c) => `<tr><td>${c.name}</td><td>0</td><td>${c.registered}</td><td>0%</td><td>100%</td><td><span class="Y"></span></td><td><span class="N"></span></td><td><span class="Y"></span></td><td><span class="N"></span></td><td><span class="N"></span></td></tr>`).join('')}</table>`;
		const rows = parseReporting(html, feed);
		expect(rows).toHaveLength(67);
		expect(rows[0].precinctsComplete).toBe(true);
		expect(rows[0].mailComplete).toBe(false);
		expect(rows[0].overseasComplete).toBe(false);
	});
	it('rejects wrong-election, truncated, negative and duplicate candidate rows', () => {
		const head =
			'ElectionDate\tPartyCode\tRaceCode\tRaceName\tCountyCode\tPrecincts\tPrecinctsReporting\tCanNameLast\tCanNameFirst\tCanVotes';
		const row = '11/03/2026\tREP\tGOV\tGovernor\tALA\t63\t20\tAvila\tDonalds\t500';
		expect(parseResults(`${head}\n${row}`)[0].name).toBe('Donalds');
		for (const bad of [
			row.replace('2026', '2024'),
			row.replace('500', '-1'),
			row.slice(0, -5),
			`${row}\n${row}`
		])
			expect(() => parseResults(`${head}\n${bad}`)).toThrow();
	});
});

describe('isolated simulations and bounded history', () => {
	it('covers all developer states without mutating its input', () => {
		const original = JSON.stringify(fixture);
		for (const s of SIMULATIONS) {
			const view = simulateElection(fixture, s.id, new Date(s.at));
			expect(view.state.counties).toHaveLength(67);
			if (s.id === 'pending') expect(view.state.turnoutFinal).toBe(false);
			if (s.id === 'outage') expect(view.projectable).toBe(false);
			if (s.id === 'post') expect(view.state.phase).toBe('closed');
		}
		expect(JSON.stringify(fixture)).toBe(original);
	});
	it('deduplicates refreshes and preserves detailed recent turnout with coarse older history', () => {
		const s = snapshot();
		s.election = emptyRecord(+at);
		for (let minute = 420; minute <= 1437; minute += 3) {
			const now = new Date(ELECTION_MIDNIGHT + minute * 60_000);
			s.election.sources.turnout.acceptedAt = +now;
			s.election = observations(s, now);
			s.election = observations(s, now);
		}
		expect(s.election.history.length).toBeLessThanOrEqual(80);
		expect(s.election.history.filter((p) => p.minute >= 1317)).toHaveLength(41);
		expect(s.election.history[0].minute).toBeLessThan(480);
		expect(new Set(s.election.history.map((p) => p.minute)).size).toBe(s.election.history.length);
	});
	it('keeps election-night points when post-election updates continue', () => {
		const s = snapshot();
		s.election.night = [];
		for (let minute = 1200; minute < 30 * 1440; minute += 15) {
			const now = new Date(ELECTION_MIDNIGHT + minute * 60_000);
			s.election.sources.results.acceptedAt = +now;
			s.election = observations(s, now);
		}
		expect(s.election.night[0].minute).toBe(1200);
		expect(s.election.night.length).toBeLessThan(600);
		expect(s.election.history.length).toBeLessThanOrEqual(80);
	});
});
