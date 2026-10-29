import { addCounts, ZERO, type EdState } from './election.ts';
import {
	electionState,
	type ElectionRecord,
	type ElectionSnapshot,
	type NightObservation
} from './live.ts';
import { countedMix, raceMargin, tallyRaces } from './results.ts';
import { marginOf } from './model.ts';

export interface ElectionView extends ElectionRecord {
	state: EdState;
	projectable: boolean;
	currentNight: NightObservation[];
}

export function viewElection(snapshot: ElectionSnapshot, now = new Date()): ElectionView {
	const state = electionState(snapshot, now);
	const record = snapshot.election;
	const warnings = [...record.warnings];
	if (
		snapshot.data.partial ||
		(snapshot.data.received !== undefined && snapshot.data.received !== 67)
	)
		warnings.push(
			`Turnout source is still updating (${snapshot.data.received ?? 'unknown'}/67 counties). Turnout projections are paused.`
		);
	for (const [name, source] of Object.entries(record.sources))
		if (source.acceptedAt !== null && now.getTime() - source.acceptedAt >= 20 * 60_000)
			warnings.push(`${name} reports are delayed. Showing the last accepted data.`);
	const healthy = ['turnout', 'results'].every((key) => {
		const h = record.sources[key as 'turnout' | 'results'];
		return !h.error && h.acceptedAt !== null && now.getTime() - h.acceptedAt < 20 * 60_000;
	});
	const races = tallyRaces(record.results);
	const ballots = addCounts(state.early, state.mail, state.eday).total;
	const projectable =
		healthy &&
		!snapshot.data.partial &&
		(snapshot.data.received === undefined || snapshot.data.received === 67) &&
		races.every((r) => r.total <= ballots * 1.005) &&
		!record.warnings.some((w) => /totals differ/.test(w));
	const currentNight = projectable
		? tallyRaces(record.results)
				.filter((r) => r.total && ['GOV', 'USS', 'ATG', 'CFO', 'AGR'].includes(r.race))
				.map((r) => ({
					race: r.race,
					name: r.name,
					minute: state.minute,
					counted: ballots ? Math.min(100, (r.total / ballots) * 100) : 0,
					margin: raceMargin(r),
					registration: marginOf(countedMix(state.counties, r))
				}))
		: [];
	return { ...record, warnings, state, projectable, currentNight };
}
