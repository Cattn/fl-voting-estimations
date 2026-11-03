import type { County, FeedData, PartyCounts } from '../types.ts';
import { sourceText } from './http.ts';

export const FRESHTAKE_URL = 'https://www.freshtake.vote/2026G/';

export const COUNTIES: [string, string][] = [
	['ALA', 'Alachua'],
	['BAK', 'Baker'],
	['BAY', 'Bay'],
	['BRA', 'Bradford'],
	['BRE', 'Brevard'],
	['BRO', 'Broward'],
	['CAL', 'Calhoun'],
	['CHA', 'Charlotte'],
	['CIT', 'Citrus'],
	['CLA', 'Clay'],
	['CLL', 'Collier'],
	['CLM', 'Columbia'],
	['DES', 'DeSoto'],
	['DIX', 'Dixie'],
	['DUV', 'Duval'],
	['ESC', 'Escambia'],
	['FLA', 'Flagler'],
	['FRA', 'Franklin'],
	['GAD', 'Gadsden'],
	['GIL', 'Gilchrist'],
	['GLA', 'Glades'],
	['GUL', 'Gulf'],
	['HAM', 'Hamilton'],
	['HAR', 'Hardee'],
	['HEN', 'Hendry'],
	['HER', 'Hernando'],
	['HIG', 'Highlands'],
	['HIL', 'Hillsborough'],
	['HOL', 'Holmes'],
	['IND', 'Indian River'],
	['JAC', 'Jackson'],
	['JEF', 'Jefferson'],
	['LAF', 'Lafayette'],
	['LAK', 'Lake'],
	['LEE', 'Lee'],
	['LEO', 'Leon'],
	['LEV', 'Levy'],
	['LIB', 'Liberty'],
	['MAD', 'Madison'],
	['MAN', 'Manatee'],
	['MRN', 'Marion'],
	['MRT', 'Martin'],
	['DAD', 'Miami-Dade'],
	['MON', 'Monroe'],
	['NAS', 'Nassau'],
	['OKA', 'Okaloosa'],
	['OKE', 'Okeechobee'],
	['ORA', 'Orange'],
	['OSC', 'Osceola'],
	['PAL', 'Palm Beach'],
	['PAS', 'Pasco'],
	['PIN', 'Pinellas'],
	['POL', 'Polk'],
	['PUT', 'Putnam'],
	['SAN', 'Santa Rosa'],
	['SAR', 'Sarasota'],
	['SEM', 'Seminole'],
	['STJ', 'St. Johns'],
	['STL', 'St. Lucie'],
	['SUM', 'Sumter'],
	['SUW', 'Suwannee'],
	['TAY', 'Taylor'],
	['UNI', 'Union'],
	['VOL', 'Volusia'],
	['WAK', 'Wakulla'],
	['WAL', 'Walton'],
	['WAS', 'Washington']
];

export interface FreshTakeCounty {
	registered: number;
	early: PartyCounts;
	mail: PartyCounts;
	eday: PartyCounts;
}

export interface FreshTakeData {
	updated: string | null;
	counties: Map<string, FreshTakeCounty>;
}

export const countyKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

type Party = { rep?: number; dem?: number; oth?: number };

const counts = (p: Party | undefined): PartyCounts | null => {
	const rep = Number(p?.rep ?? 0);
	const dem = Number(p?.dem ?? 0);
	const npa = Number(p?.oth ?? 0);
	if (![rep, dem, npa].every((n) => Number.isFinite(n) && n >= 0)) return null;
	return { rep, dem, npa, oth: 0, total: rep + dem + npa };
};

export function parseFreshTake(html: string): FreshTakeData {
	const match = html.match(/COUNTY_METHODS\s*=\s*(\{[\s\S]*?\})\s*;/);
	if (!match) throw new Error('FreshTake county data is missing');
	const data = JSON.parse(match[1]) as Record<
		string,
		{ voters?: number; early?: Party; mail?: Party; eday?: Party }
	>;
	const counties = new Map<string, FreshTakeCounty>();
	for (const [name, row] of Object.entries(data)) {
		const early = counts(row.early);
		const mail = counts(row.mail);
		const eday = counts(row.eday);
		const registered = Number(row.voters ?? 0);
		if (!early || !mail || !eday || !Number.isFinite(registered)) continue;
		counties.set(countyKey(name), { registered: Math.max(0, registered), early, mail, eday });
	}
	const times = [...html.matchAll(/Last updated:\s*(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/g)]
		.map((m) => new Date(`${m[1]}T${m[2]}-05:00`))
		.filter((d) => !Number.isNaN(d.getTime()));
	const latest = times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
	return { updated: latest?.toISOString() ?? null, counties };
}

const split = (c: PartyCounts, ref: PartyCounts | undefined): PartyCounts => {
	const other = (ref?.npa ?? 0) + (ref?.oth ?? 0);
	const oth = other > 0 ? Math.round((c.npa * (ref?.oth ?? 0)) / other) : 0;
	return { ...c, npa: c.npa - oth, oth };
};

const sum = (rows: PartyCounts[]): PartyCounts =>
	rows.reduce(
		(a, r) => ({
			rep: a.rep + r.rep,
			dem: a.dem + r.dem,
			npa: a.npa + r.npa,
			oth: a.oth + r.oth,
			total: a.total + r.total
		}),
		{ rep: 0, dem: 0, npa: 0, oth: 0, total: 0 }
	);

const same = (a: PartyCounts | undefined, b: PartyCounts) =>
	!!a && a.rep === b.rep && a.dem === b.dem && a.npa + a.oth === b.npa + b.oth;

export function freshTakeFeed(ft: FreshTakeData, previous?: FeedData, now = new Date()): FeedData {
	const updated = ft.updated ?? now.toISOString();
	const counties = COUNTIES.map(([code, name]): County => {
		const row = ft.counties.get(countyKey(name));
		if (!row) throw new Error(`FreshTake is missing ${name}`);
		const old = previous?.counties.find((c) => c.code === code);
		const eday = split(row.eday, old?.eday?.total ? old.eday : old?.early);
		return {
			code,
			name,
			registered: row.registered || old?.registered || 0,
			early: split(row.early, old?.early),
			mail: split(row.mail, old?.mail),
			eday,
			status: 'live',
			updated: old?.updated && same(old.eday, eday) ? old.updated : updated
		};
	});
	return {
		source: FRESHTAKE_URL,
		fetchedAt: updated,
		partial: false,
		received: counties.length,
		windowOpen: false,
		registered: counties.reduce((n, c) => n + c.registered, 0),
		early: sum(counties.map((c) => c.early)),
		mail: sum(counties.map((c) => c.mail)),
		eday: sum(counties.map((c) => c.eday!)),
		outstanding: previous?.outstanding ?? { rep: 0, dem: 0, npa: 0, oth: 0, total: 0 },
		counties,
		earlyDays: previous?.earlyDays ?? [],
		mailDays: previous?.mailDays ?? [],
		...(previous?.lastReportedMail ? { lastReportedMail: previous.lastReportedMail } : {})
	};
}

export async function fetchFreshTake(): Promise<FreshTakeData> {
	const page = await sourceText(`${FRESHTAKE_URL}?t=${Date.now()}`, 3_000_000, 10_000);
	return parseFreshTake(page.text);
}
