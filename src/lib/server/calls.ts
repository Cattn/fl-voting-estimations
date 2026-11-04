import type { RaceCalls } from '../types.ts';
import { sourceText } from './http.ts';

export const CALLS_URL =
	'https://www.nbcnews.com/firecracker/api/v2/state-results/2026-elections/florida-results';

const OFFICES: Record<string, string> = { G: 'GOV', S: 'USS', A: 'ATG' };

type Candidate = {
	name?: string;
	lastName?: string;
	party?: string;
	isWinner?: boolean;
	callStatus?: string;
};
type Race = { officeCode?: string; district?: number; candidates?: Candidate[] };

const party = (p = '') =>
	({ gop: 'REP', rep: 'REP', dem: 'DEM' })[p.toLowerCase()] ?? p.toUpperCase();

const winner = (race: Race) => {
	const won = (race.candidates ?? []).filter(
		(c) => c.isWinner && ['P', 'W'].includes(c.callStatus ?? '')
	);
	if (won.length !== 1 || !won[0].lastName) return null;
	return {
		name: won[0].name ?? won[0].lastName,
		lastName: won[0].lastName,
		party: party(won[0].party)
	};
};

export function parseCalls(json: unknown, now = new Date()): RaceCalls {
	const results = (json as { stateRaceResults?: Record<string, unknown> }).stateRaceResults;
	if (!results) throw new Error('Race calls are missing results');
	const races: RaceCalls['races'] = {};
	const list = (key: string) => {
		const v = results[key];
		return Array.isArray(v) ? (v as Race[]) : [];
	};
	for (const race of [...list('discreteOffices'), ...list('otherRaces')]) {
		const code = OFFICES[race.officeCode ?? ''];
		const w = code && winner(race);
		if (code && w) races[code] = w;
	}
	for (const race of list('house')) {
		const w = race.district ? winner(race) : null;
		if (w) races[`USR-${race.district}`] = w;
	}
	return { checkedAt: now.getTime(), races };
}

export async function fetchCalls(now = new Date()): Promise<RaceCalls> {
	const page = await sourceText(`${CALLS_URL}?t=${now.getTime()}`, 3_000_000, 15_000);
	return parseCalls(JSON.parse(page.text), now);
}
