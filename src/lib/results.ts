import { marginOf } from './model.ts';
import { addCounts, scaleCounts, ZERO } from './election.ts';
import type { County, PartyCounts } from './types.ts';
import { ELECTION_DAY } from './model.ts';

export const RESULTS_URL =
	'https://flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt';

export interface ResultRow {
	race: string;
	raceName: string;
	county: string;
	party: string;
	name: string;
	votes: number;
	precincts: number;
	reporting: number;
	district?: number;
}

const TICKETS = new Set(['GOV', 'PRE']);

export function parseResults(text: string): ResultRow[] {
	const [head, ...lines] = text.split(/\r?\n/).filter((l) => l.trim());
	if (!head || !lines.length) throw new Error('Empty results file');
	const cols = head.replace(/^\uFEFF/, '').split('\t');
	const at = (name: string) => cols.indexOf(name);
	const idx = {
		party: at('PartyCode'),
		race: at('RaceCode'),
		raceName: at('RaceName'),
		county: at('CountyCode'),
		precincts: at('Precincts'),
		reporting: at('PrecinctsReporting'),
		last: at('CanNameLast'),
		first: at('CanNameFirst'),
		votes: at('CanVotes')
	};
	if (Object.values(idx).some((i) => i < 0))
		throw new Error('Results file is missing required columns');
	const seen = new Set<string>();
	return lines.map((line) => {
		const f = line.split('\t');
		if (f.length < cols.length) throw new Error('Truncated results row');
		const date = f[at('ElectionDate')]?.trim();
		if (at('ElectionDate') >= 0 && date !== '11/03/2026' && date !== ELECTION_DAY)
			throw new Error('Results file is for another election');
		const race = f[idx.race].trim();
		const county = f[idx.county].trim();
		const party = f[idx.party].trim();
		const name = (TICKETS.has(race) ? f[idx.first] : f[idx.last]).trim();
		const number = (i: number) => {
			if (!/^\d+$/.test(f[i].trim()) || !Number.isSafeInteger(Number(f[i])))
				throw new Error('Invalid numeric result');
			return Number(f[i]);
		};
		const key = `${race}|${f[idx.raceName]}|${county}|${party}|${name}`;
		if (!county || !name || seen.has(key)) throw new Error('Missing or duplicate result identity');
		seen.add(key);
		return {
			race,
			raceName: f[idx.raceName].trim(),
			county,
			party,
			name,
			votes: number(idx.votes),
			precincts: number(idx.precincts),
			reporting: number(idx.reporting),
			...(race === 'USR'
				? { district: Number(f[at('Juris1num')]) || districtOf(f[idx.raceName]) }
				: {})
		};
	});
}

export interface Candidate {
	name: string;
	party: string;
	votes: number;
}

export interface CountyTally {
	county: string;
	candidates: Candidate[];
	total: number;
	precincts: number;
	reporting: number;
}

export interface RaceTally {
	race: string;
	name: string;
	candidates: Candidate[];
	total: number;
	precincts: number;
	reporting: number;
	counties: CountyTally[];
	district?: number;
}

const byVotes = (a: Candidate, b: Candidate) => b.votes - a.votes;

export function tallyRaces(rows: ResultRow[]): RaceTally[] {
	const races = new Map<string, RaceTally>();
	const counties = new Map<string, CountyTally>();
	for (const r of rows) {
		const key = `${r.race}|${r.raceName}`;
		let race = races.get(key);
		if (!race) {
			race = {
				race: r.race,
				name: r.raceName,
				district: r.district,
				candidates: [],
				total: 0,
				precincts: 0,
				reporting: 0,
				counties: []
			};
			races.set(key, race);
		}
		let c = counties.get(`${key}|${r.county}`);
		if (!c) {
			c = {
				county: r.county,
				candidates: [],
				total: 0,
				precincts: r.precincts,
				reporting: r.reporting
			};
			counties.set(`${key}|${r.county}`, c);
			race.counties.push(c);
			race.precincts += r.precincts;
			race.reporting += r.reporting;
		}
		c.candidates.push({ name: r.name, party: r.party, votes: r.votes });
		c.total += r.votes;
		race.total += r.votes;
		const statewide = race.candidates.find((x) => x.name === r.name && x.party === r.party);
		if (statewide) statewide.votes += r.votes;
		else race.candidates.push({ name: r.name, party: r.party, votes: r.votes });
	}
	for (const race of races.values()) {
		race.candidates.sort(byVotes);
		race.counties.forEach((c) => c.candidates.sort(byVotes));
	}
	return [...races.values()];
}

export const lead = (cands: Candidate[], party: string) =>
	cands.find((c) => c.party === party)?.votes ?? 0;

export function raceMargin(t: { candidates: Candidate[]; total: number }): number {
	return t.total ? ((lead(t.candidates, 'DEM') - lead(t.candidates, 'REP')) / t.total) * 100 : 0;
}

export function countedMix(counties: County[], race: RaceTally): PartyCounts {
	let mix = ZERO;
	for (const c of race.counties) {
		const county = counties.find((x) => x.code === c.county);
		if (!county) continue;
		const early = addCounts(county.early, county.mail);
		const eday = county.eday ?? ZERO;
		const firstWave = Math.min(c.total, early.total);
		const rest = Math.min(Math.max(0, c.total - early.total), eday.total);
		mix = addCounts(
			mix,
			early.total ? scaleCounts(early, firstWave / early.total) : ZERO,
			eday.total ? scaleCounts(eday, rest / eday.total) : ZERO
		);
	}
	return mix;
}

export interface Projection {
	counted: number;
	registration: number;
	ahead: number;
	projected: number;
	range: number;
}

export function projectRace(
	counties: County[],
	race: RaceTally,
	ballots: number,
	finalElectorate: number
): Projection {
	const mix = countedMix(counties, race);
	const counted = ballots ? Math.min(1, race.total / ballots) : 0;
	const registration = marginOf(mix);
	const ahead = raceMargin(race) - registration;
	return {
		counted,
		registration,
		ahead,
		projected: finalElectorate + ahead,
		range: 0.5 + 6 * (1 - counted)
	};
}

export interface District {
	n: number;
	trump24: number;
	uncontested?: boolean;
}

export const DISTRICTS: District[] = [
	{ n: 1, trump24: 38.98 },
	{ n: 2, trump24: 18.07 },
	{ n: 3, trump24: 20.99 },
	{ n: 4, trump24: 11.8 },
	{ n: 5, trump24: 21.34 },
	{ n: 6, trump24: 29.99 },
	{ n: 7, trump24: 12.42 },
	{ n: 8, trump24: 16.14 },
	{ n: 9, trump24: 17.71 },
	{ n: 10, trump24: -23.89 },
	{ n: 11, trump24: 15.63 },
	{ n: 12, trump24: 15.33 },
	{ n: 13, trump24: 13.26 },
	{ n: 14, trump24: 10.47 },
	{ n: 15, trump24: 19.77 },
	{ n: 16, trump24: 13.64 },
	{ n: 17, trump24: 22 },
	{ n: 18, trump24: 16.9 },
	{ n: 19, trump24: 30.08 },
	{ n: 20, trump24: -37.06 },
	{ n: 21, trump24: 16.17 },
	{ n: 22, trump24: 10.47 },
	{ n: 23, trump24: -13.77 },
	{ n: 24, trump24: -38.62 },
	{ n: 25, trump24: 9.11 },
	{ n: 26, trump24: 18.32 },
	{ n: 27, trump24: 14.53 },
	{ n: 28, trump24: 25.39 }
];

export const districtOf = (raceName: string) => Number(/District (\d+)/.exec(raceName)?.[1]) || 0;

export interface DistrictResult {
	district: District;
	race: RaceTally | null;
	rep: Candidate | null;
	dem: Candidate | null;
	margin: number;
	counted: number;
	shift: number;
	projected: number;
	range: number;
}

export function districtResults(races: RaceTally[], drift: number): DistrictResult[] {
	return DISTRICTS.map((district) => {
		const race =
			races.find((r) => r.race === 'USR' && (r.district ?? districtOf(r.name)) === district.n) ??
			null;
		const pick = (party: string) => race?.candidates.find((c) => c.party === party) ?? null;
		const counted = race?.precincts ? Math.max(0, Math.min(1, race.reporting / race.precincts)) : 0;
		const margin = race ? raceMargin(race) : 0;
		return {
			district,
			race,
			rep: pick('REP'),
			dem: pick('DEM'),
			margin,
			counted,
			shift: margin + district.trump24,
			projected: Math.max(-100, Math.min(100, margin + (1 - counted) * drift)),
			range: 0.5 + 8 * (1 - counted)
		};
	});
}

export function closestDistricts(rows: DistrictResult[], n = 4): DistrictResult[] {
	return rows
		.filter((r) => !r.district.uncontested && r.race?.total)
		.sort(
			(a, b) =>
				Math.abs(a.counted >= 0.2 ? a.projected : a.margin) -
				Math.abs(b.counted >= 0.2 ? b.projected : b.margin)
		)
		.slice(0, n);
}

export const PRES_2024: Record<string, number> = {
	ALA: -20.97,
	BAK: 73.07,
	BAY: 47.35,
	BRA: 57.24,
	BRE: 20.83,
	BRO: -16.97,
	CAL: 67.61,
	CHA: 33.98,
	CIT: 45.89,
	CLA: 39.26,
	CLL: 33.07,
	CLM: 50.18,
	DAD: 11.45,
	DES: 42.95,
	DIX: 70.41,
	DUV: 1.47,
	ESC: 19.54,
	FLA: 28.24,
	FRA: 43.81,
	GAD: -30.67,
	GIL: 68.02,
	GLA: 53.27,
	GUL: 54.2,
	HAM: 39.02,
	HAR: 56.31,
	HEN: 38.31,
	HER: 37.05,
	HIG: 40.76,
	HIL: 3.06,
	HOL: 80.2,
	IND: 27.35,
	JAC: 46.08,
	JEF: 18.61,
	LAF: 76.01,
	LAK: 24.67,
	LEE: 28.39,
	LEO: -21.76,
	LEV: 50.25,
	LIB: 66.82,
	MAD: 28.87,
	MAN: 23.51,
	MON: 18.34,
	MRN: 31.64,
	MRT: 31.11,
	NAS: 46.94,
	OKA: 42.45,
	OKE: 53.83,
	ORA: -13.59,
	OSC: 1.45,
	PAL: -0.76,
	PAS: 25.22,
	PIN: 5.23,
	POL: 20.68,
	PUT: 47.82,
	SAN: 50.95,
	SAR: 18.19,
	SEM: 3.55,
	STJ: 31.35,
	STL: 9.06,
	SUM: 37.62,
	SUW: 60.96,
	TAY: 59.65,
	UNI: 68.26,
	VOL: 21.76,
	WAK: 44.34,
	WAL: 57.83,
	WAS: 65.4
};

export const PRES_2024_STATE = 13.1;
