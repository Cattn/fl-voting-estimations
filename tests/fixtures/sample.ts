import {
	addCounts,
	dayShare,
	DEFAULT_PRESET,
	LATE_MAIL,
	localMinute,
	notYetVoted,
	phaseAt,
	POLLS_CLOSE,
	POLLS_OPEN,
	PRESETS,
	RESULTS_START,
	scaleCounts,
	ZERO,
	type EdSnapshot,
	type EdState
} from '../../src/lib/election.ts';
import { marginOf } from '../../src/lib/model.ts';
import { DISTRICTS as districts, type ResultRow } from '../../src/lib/results.ts';
import type { County, FeedData, PartyCounts } from '../../src/lib/types.ts';

const EV_FINAL = { early: 3_400_000, mail: 1_870_000 };
const DISTRICTS = districts.map((district) => ({ ...district, uncontested: district.n === 10 }));
const TRUE_SHARES = PRESETS.find((p) => p.id === DEFAULT_PRESET)!;
const ED_MIDNIGHT_UTC = Date.UTC(2026, 10, 3, 5, 0);

const hash = (s: string) => {
	let h = 2166136261;
	for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
	return ((h >>> 0) % 10_000) / 10_000;
};

const iso = (minute: number) => new Date(ED_MIDNIGHT_UTC + minute * 60_000).toISOString();

const mix = (total: number, rep: number, dem: number): PartyCounts => ({
	rep: total * rep,
	dem: total * dem,
	npa: total * (1 - rep - dem),
	oth: 0,
	total
});

const clamp = (v: number) => Math.max(0, Math.min(1, v));

function finalEarlyVote(feed: FeedData) {
	const extraEarly = Math.max(0, EV_FINAL.early - feed.early.total);
	const extraMail = Math.max(0, EV_FINAL.mail - feed.mail.total);
	const mailRatio = feed.mail.total ? feed.mail : mix(1, 0.37, 0.45);
	return feed.counties.map((c) => {
		const earlyShare = feed.early.total ? c.early.total / feed.early.total : 0;
		const mailShare = feed.mail.total ? c.mail.total / feed.mail.total : 0;
		return {
			...c,
			early: addCounts(c.early, mix(extraEarly * earlyShare, 0.48, 0.33)),
			mail: addCounts(
				c.mail,
				scaleCounts(mailRatio, (extraMail * mailShare) / Math.max(1, mailRatio.total))
			)
		};
	});
}

function lateMailArrived(minute: number): number {
	if (minute < 0) return 45_000 * clamp((minute + 1440) / 1440);
	return (
		45_000 + (LATE_MAIL.total - 45_000) * clamp((minute - POLLS_OPEN) / (POLLS_CLOSE - POLLS_OPEN))
	);
}

const lag = (code: string) => 5 + Math.round(hash(code + 'lag') * 35);
const lateStart = (code: string) => hash(code + 'late') < 0.045;

function countyEday(
	code: string,
	full: PartyCounts,
	minute: number
): { counts: PartyCounts; at: number } {
	if (minute < POLLS_OPEN) return { counts: ZERO, at: minute };
	if (minute >= POLLS_CLOSE + 60) return { counts: full, at: POLLS_CLOSE + 60 };
	if (lateStart(code) && minute < 12 * 60) return { counts: ZERO, at: minute };
	const at = Math.max(POLLS_OPEN, Math.floor((minute - lag(code)) / 10) * 10);
	const share = dayShare(localMinute(code, at));
	const rep = full.rep * share ** 0.93;
	const dem = full.dem * share ** 1.08;
	const npa = full.npa * share;
	return { counts: { rep, dem, npa, oth: 0, total: rep + dem + npa }, at };
}

const round = (r: PartyCounts): PartyCounts => {
	const rep = Math.round(r.rep);
	const dem = Math.round(r.dem);
	const npa = Math.round(r.npa);
	const oth = Math.round(r.oth);
	return { rep, dem, npa, oth, total: rep + dem + npa + oth };
};

export interface Sample {
	state: EdState;
	results: ResultRow[];
}

export function sampleElection(feed: FeedData, minute: number): Sample {
	const base = finalEarlyVote(feed);
	const early = addCounts(...base.map((c) => c.early));
	const evMail = addCounts(...base.map((c) => c.mail));
	const pool = notYetVoted({
		minute,
		phase: 'pre',
		counties: base,
		early,
		mail: evMail,
		evMail,
		eday: ZERO,
		history: []
	});
	const full = {
		rep: pool.rep * TRUE_SHARES.rep,
		dem: pool.dem * TRUE_SHARES.dem,
		npa: pool.oth * TRUE_SHARES.oth
	};
	const lateMix = mix(1, 0.365, 0.475);
	const countyFull = (c: County): PartyCounts => {
		const w = (k: 'rep' | 'dem') => (early[k] ? c.early[k] / early[k] : 0);
		const o = early.npa + early.oth ? (c.early.npa + c.early.oth) / (early.npa + early.oth) : 0;
		const rep = full.rep * w('rep');
		const dem = full.dem * w('dem');
		const npa = full.npa * o;
		return { rep, dem, npa, oth: 0, total: rep + dem + npa };
	};
	const mailShare = (c: County) => (evMail.total ? c.mail.total / evMail.total : 0);

	const at = (m: number) => {
		const arrived = lateMailArrived(m);
		const counties = base.map((c) => {
			const e = countyEday(c.code, countyFull(c), m);
			return {
				...c,
				mail: round(addCounts(c.mail, scaleCounts(lateMix, arrived * mailShare(c)))),
				eday: round(e.counts),
				updated: iso(e.at)
			};
		});
		return {
			counties,
			mail: addCounts(...counties.map((c) => c.mail)),
			eday: addCounts(...counties.map((c) => c.eday))
		};
	};

	const now = at(minute);
	const history: EdSnapshot[] = [];
	for (let m = POLLS_OPEN; m <= Math.min(minute, POLLS_CLOSE + 60); m += 30) {
		const s = at(m);
		history.push({
			minute: m,
			eday: s.eday,
			mail: s.mail,
			counties: s.counties.map(({ code, eday, updated }) => ({ code, eday, updated }))
		});
	}
	if (minute > POLLS_OPEN && minute < POLLS_CLOSE + 60 && minute % 30)
		history.push({
			minute,
			eday: now.eday,
			mail: now.mail,
			counties: now.counties.map(({ code, eday, updated }) => ({ code, eday, updated }))
		});

	const state: EdState = {
		minute,
		phase: phaseAt(minute),
		counties: now.counties,
		early: round(early),
		mail: now.mail,
		evMail: round(evMail),
		eday: now.eday,
		history
	};
	return { state, results: sampleResults(state, minute) };
}

interface RaceDef {
	race: string;
	name: string;
	ahead: number;
	rep: string;
	dem: string;
	others: { name: string; party: string; share: number }[];
}

const RACES: RaceDef[] = [
	{
		race: 'GOV',
		name: 'Governor',
		ahead: -3.2,
		rep: 'Donalds',
		dem: 'Jolly',
		others: [
			{ name: 'Jewett', party: 'LPF', share: 0.005 },
			{ name: 'Burkett', party: 'NPA', share: 0.003 },
			{ name: 'Russo', party: 'NPA', share: 0.003 }
		]
	},
	{
		race: 'USS',
		name: 'United States Senator',
		ahead: -2.1,
		rep: 'Moody',
		dem: 'Nixon',
		others: [{ name: 'Gillespie', party: 'NPA', share: 0.013 }]
	},
	{
		race: 'ATG',
		name: 'Attorney General',
		ahead: -2.7,
		rep: 'Uthmeier',
		dem: 'Rodriguez',
		others: []
	},
	{
		race: 'CFO',
		name: 'Chief Financial Officer',
		ahead: -1.6,
		rep: 'Ingoglia',
		dem: 'Taddeo',
		others: []
	},
	{
		race: 'AGR',
		name: 'Commissioner of Agriculture',
		ahead: -2.4,
		rep: 'Simpson',
		dem: 'Mendoza Atkins',
		others: [{ name: 'Gibson', party: 'WRI', share: 0.004 }]
	}
];

const AMENDMENTS = [
	{
		name: 'Increased Homestead Exemption; Lower Cap On Increases In Non-Homestead Property Assessments',
		yes: 0.66
	},
	{ name: 'Exemption of Tangible Personal Property on Agricultural Land From Taxation', yes: 0.62 },
	{ name: 'Budget Stabilization Fund', yes: 0.575 }
];

export const CONGRESS: Record<number, [string, string]> = {
	1: ['Patronis', 'Valimont'],
	2: ['Rogers', 'Green'],
	3: ['Cammack', 'Harp'],
	4: ['Bean', 'Holloway'],
	5: ['Rutherford', 'Grage'],
	6: ['Fine', 'Yonce'],
	7: ['Elijah', 'Dalton'],
	8: ['Haridopolos', 'Jenkins'],
	9: ['Green', 'Soto'],
	11: ['Strada', 'Pericola'],
	12: ['Bilirakis', 'Overman'],
	13: ['Luna', 'Gray'],
	14: ['Beltran', 'Castor'],
	15: ['Lee', 'People'],
	16: ['Gruters', 'Kirschner'],
	17: ['Steube', 'Montavon'],
	18: ['Franklin', 'Gibson'],
	19: ['Schwartzel', 'Arias'],
	20: ['Andersen', 'Wasserman Schultz'],
	21: ['Mast', 'Martin'],
	22: ['Askar', 'Dandiya'],
	23: ['Adeimy', 'Frankel'],
	24: ['Brown', 'Gilbert'],
	25: ['Singer', 'Moskowitz'],
	26: ['Diaz-Balart', 'Locklin'],
	27: ['Salazar', 'Rodriguez'],
	28: ['Gimenez', 'Ehr']
};

function countyProgress(c: County, minute: number) {
	const precincts = Math.max(4, Math.round(c.registered / 2500));
	if (minute < RESULTS_START) return { counted: ZERO, frac: 0, precincts, reporting: 0 };
	const posted = minute >= RESULTS_START + hash(c.code + 'post') * 20;
	const start = RESULTS_START + 15 + hash(c.code + 'ed') * 30;
	const frac = clamp((minute - start) / (90 + hash(c.code + 'len') * 90));
	const early = addCounts(c.early, c.mail);
	const counted = addCounts(posted ? early : ZERO, scaleCounts(c.eday ?? ZERO, frac));
	return { counted, frac, precincts, reporting: Math.round(precincts * frac) };
}

function sampleResults(s: EdState, minute: number): ResultRow[] {
	const rows: ResultRow[] = [];
	const progress = s.counties.map((c) => ({ c, ...countyProgress(c, minute) }));
	const push = (
		race: string,
		raceName: string,
		county: string,
		party: string,
		name: string,
		votes: number,
		precincts: number,
		reporting: number
	) =>
		rows.push({
			race,
			raceName,
			county,
			party,
			name,
			votes: Math.round(votes),
			precincts,
			reporting
		});

	for (const def of RACES) {
		for (const { c, counted, precincts, reporting } of progress) {
			const others = def.others.reduce((a, o) => a + o.share, 0);
			const m =
				clamp((marginOf(counted) + def.ahead + (hash(c.code + def.race) - 0.5) * 6 + 100) / 200) *
					200 -
				100;
			const two = counted.total * (1 - others);
			push(
				def.race,
				def.name,
				c.code,
				'REP',
				def.rep,
				(two * (100 - m)) / 200,
				precincts,
				reporting
			);
			push(
				def.race,
				def.name,
				c.code,
				'DEM',
				def.dem,
				(two * (100 + m)) / 200,
				precincts,
				reporting
			);
			for (const o of def.others)
				push(
					def.race,
					def.name,
					c.code,
					o.party,
					o.name,
					counted.total * o.share,
					precincts,
					reporting
				);
		}
	}
	for (const a of AMENDMENTS) {
		for (const { c, counted, precincts, reporting } of progress) {
			const yes = a.yes + (hash(c.code + a.name) - 0.5) * 0.08;
			push(
				'AMD',
				a.name,
				c.code,
				'NOP',
				'Yes for Approval',
				counted.total * 0.96 * yes,
				precincts,
				reporting
			);
			push(
				'AMD',
				a.name,
				c.code,
				'NOP',
				'No for Rejection',
				counted.total * 0.96 * (1 - yes),
				precincts,
				reporting
			);
		}
	}

	const counted = addCounts(...progress.map((p) => p.counted));
	const all = addCounts(s.early, s.mail, s.eday);
	const share = all.total ? counted.total / all.total : 0;
	const remaining = addCounts(all, scaleCounts(counted, -1));
	const drift =
		remaining.total > 1000 && counted.total ? marginOf(remaining) - marginOf(counted) : 0;
	const perDistrict = all.total / 27;
	for (const d of DISTRICTS) {
		const names = CONGRESS[d.n];
		if (d.uncontested || !names) continue;
		const c = share ? clamp(share + (hash(`cd${d.n}`) - 0.5) * 0.12 * (1 - share)) : 0;
		const final =
			-d.trump24 + 3.4 + (hash(`shift${d.n}`) - 0.5) * 4 + (d.n === 14 || d.n === 25 ? 3.5 : 0);
		const m = final - (1 - c) * drift;
		const votes = perDistrict * (0.9 + hash(`size${d.n}`) * 0.2) * c;
		const raceName = `Representative in Congress, District ${d.n}`;
		const reporting = Math.round(c * 100);
		push('USR', raceName, 'ALL', 'REP', names[0], (votes * 0.99 * (100 - m)) / 200, 100, reporting);
		push('USR', raceName, 'ALL', 'DEM', names[1], (votes * 0.99 * (100 + m)) / 200, 100, reporting);
		push('USR', raceName, 'ALL', 'NPA', 'Other', votes * 0.01, 100, reporting);
	}
	return rows;
}

export function parsePreview(params: URLSearchParams): number {
	const phase = params.get('phase');
	const at = /^(\d{1,2}):(\d{2})$/.exec(params.get('at') ?? '');
	const valid = at && Number(at[1]) < 24 && Number(at[2]) < 60;
	const minute = valid ? Number(at[1]) * 60 + Number(at[2]) : null;
	if (phase === 'pre') return (minute ?? 15 * 60 + 10) - 1440;
	if (phase === 'closed') return Math.max(POLLS_CLOSE + 60, minute ?? 22 * 60 + 15);
	if (phase === 'open')
		return Math.max(POLLS_OPEN, Math.min(POLLS_CLOSE + 59, minute ?? 14 * 60 + 30));
	return minute ?? 14 * 60 + 30;
}
