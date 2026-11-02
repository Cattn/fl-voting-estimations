import { addCounts, RESULTS_START, ZERO, type EdState } from './election.ts';
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

const SOURCES = ['turnout', 'results', 'reporting'] as const;
const label = (name: string) => name[0].toUpperCase() + name.slice(1);

export function electionNotice(view: ElectionView): string | null {
	const counting = view.state.minute >= RESULTS_START;
	const shown = (name: string) => name === 'turnout' || counting;
	const parts = new Set<string>();
	let paused = false;
	for (const warning of view.warnings) {
		const updating = /still updating \((\w+)\/67/.exec(warning);
		const source = SOURCES.find((s) => warning.toLowerCase().startsWith(s));
		if (updating) {
			parts.add(`Turnout source updating (${updating[1]}/67 counties)`);
			paused = true;
		} else if (/totals differ/.test(warning)) {
			parts.add('County and statewide totals differ');
			paused = true;
		} else if (/baseline is unavailable/.test(warning)) parts.add('Late-mail estimate paused');
		else if (/delayed turnout reports/.test(warning)) parts.add('Some county reports delayed');
		else if (/downward correction/.test(warning))
			parts.add('A source posted a downward correction');
		else if (source) {
			if (shown(source)) parts.add(`${label(source)} data delayed`);
		} else parts.add(warning);
	}
	for (const name of SOURCES)
		if (view.sources[name].error && shown(name)) parts.add(`${label(name)} data delayed`);
	if (!parts.size) return null;
	return [...parts].join(' · ') + (paused && counting ? ' · result projections paused' : '');
}
