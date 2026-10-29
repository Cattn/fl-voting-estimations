import { sampleElection } from './sample.ts';
import { electionClock, ELECTION_MIDNIGHT } from '../../src/lib/election-clock.ts';
import { addCounts, ZERO } from '../../src/lib/election.ts';
import { viewElection, type ElectionView } from '../../src/lib/view-election.ts';
import { emptyRecord } from './record.ts';
import type { FeedData } from '../../src/lib/types.ts';

export const SIMULATIONS = [
	{ id: 'early', label: 'Early voting', at: '2026-10-31T14:30:00-04:00' },
	{ id: 'pre', label: 'EV ended', at: '2026-11-02T15:10:00-05:00' },
	{ id: 'open', label: 'Polls open', at: '2026-11-03T14:30:00-05:00' },
	{ id: 'late', label: 'Late day', at: '2026-11-03T18:30:00-05:00' },
	{ id: 'closed', label: 'Polls closed', at: '2026-11-03T22:15:00-05:00' },
	{ id: 'pending', label: 'Turnout pending', at: '2026-11-03T20:15:00-05:00' },
	{ id: 'stale', label: 'Stale turnout', at: '2026-11-03T17:00:00-05:00' },
	{ id: 'missing', label: 'Missing counties', at: '2026-11-03T17:00:00-05:00' },
	{ id: 'correction', label: 'Correction', at: '2026-11-03T22:15:00-05:00' },
	{ id: 'outage', label: 'Results outage', at: '2026-11-03T22:15:00-05:00' },
	{ id: 'post', label: 'Next day', at: '2026-11-04T10:00:00-05:00' }
] as const;

export type Simulation = (typeof SIMULATIONS)[number]['id'];

export function simulateElection(feed: FeedData, mode: Simulation, now: Date): ElectionView {
	const clock = electionClock(now);
	const minute = mode === 'post' ? 1430 : mode === 'stale' ? 14 * 60 : clock.minute;
	const sample = sampleElection(feed, minute);
	const generated: FeedData = {
		...feed,
		early: sample.state.early,
		mail: sample.state.mail,
		eday: sample.state.eday,
		counties: sample.state.counties,
		fetchedAt: now.toISOString()
	};
	const record = emptyRecord(now.getTime());
	record.results = sample.results;
	record.history = sample.state.history;
	record.baseline = {
		at: Date.parse('2026-11-02T00:00:00-05:00'),
		early: sample.state.early,
		mail: sample.state.evMail
	};
	record.reporting = generated.counties.map((c) => ({
		code: c.code,
		registered: c.registered,
		turnout: c.early.total + c.mail.total + (c.eday?.total ?? 0),
		precinctsComplete: clock.phase === 'closed',
		mailComplete: clock.phase === 'closed',
		earlyComplete: true,
		provisionalComplete: mode === 'post',
		overseasComplete: mode === 'post'
	}));
	if (mode === 'pending' || mode === 'missing') {
		const missing = new Set(
			generated.counties.filter((c) => c.code === 'DAD' || c.code === 'BRO').map((c) => c.code)
		);
		for (const c of generated.counties)
			if (missing.has(c.code)) {
				c.eday = ZERO;
				c.edayUpdated = undefined;
				c.status = 'delayed';
			}
		generated.eday = addCounts(...generated.counties.map((c) => c.eday ?? ZERO));
		for (const h of record.history) {
			for (const c of h.counties ?? []) if (missing.has(c.code)) c.eday = ZERO;
			h.eday = addCounts(...(h.counties ?? []).map((c) => c.eday ?? ZERO));
		}
		for (const r of record.reporting) if (missing.has(r.code)) r.precinctsComplete = false;
		record.warnings.push(
			'Simulation: two large counties have not supplied their Election Day turnout.'
		);
	}
	if (mode === 'stale') {
		record.sources.turnout.acceptedAt = now.getTime() - 3 * 60 * 60_000;
		record.sources.turnout.error =
			'Simulation: turnout source timed out; previous counts retained.';
	}
	if (mode === 'outage')
		record.sources.results.error =
			'Simulation: results source unavailable; last accepted results retained.';
	if (mode === 'correction') {
		for (const r of record.results)
			if (r.race === 'GOV' && r.party === 'REP' && r.county === 'DAD')
				r.votes = Math.max(0, r.votes - 20_000);
		record.warnings.push(
			'Simulation: the official source corrected Miami-Dade Republican votes downward by 20,000.'
		);
	}
	for (let m = 20 * 60; m <= Math.min(minute, 1430); m += 15) {
		const s = sampleElection(feed, m);
		const at = new Date(ELECTION_MIDNIGHT + m * 60_000);
		const v = viewElection(
			{
				at: at.getTime(),
				data: {
					...generated,
					early: s.state.early,
					mail: s.state.mail,
					eday: s.state.eday,
					counties: s.state.counties
				},
				election: { ...record, history: [], night: [] }
			},
			at
		);
		record.night.push(...v.currentNight);
	}
	const view = viewElection({ at: now.getTime(), data: generated, election: record }, now);
	view.state.registration = undefined;
	return view;
}
