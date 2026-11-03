import type { PartyCounts } from '../types.ts';
import { sourceText } from './http.ts';

export const FRESHTAKE_URL = 'https://www.freshtake.vote/2026G/';

export interface FreshTakeEday {
	updated: string | null;
	counties: Map<string, PartyCounts>;
}

export const countyKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

type Party = { rep?: number; dem?: number; oth?: number };

export function parseFreshTake(html: string): FreshTakeEday {
	const match = html.match(/COUNTY_METHODS\s*=\s*(\{[\s\S]*?\})\s*;/);
	if (!match) throw new Error('FreshTake county data is missing');
	const data = JSON.parse(match[1]) as Record<string, { eday?: Party }>;
	const counties = new Map<string, PartyCounts>();
	for (const [name, row] of Object.entries(data)) {
		const rep = Number(row.eday?.rep ?? 0);
		const dem = Number(row.eday?.dem ?? 0);
		const npa = Number(row.eday?.oth ?? 0);
		if (![rep, dem, npa].every((n) => Number.isFinite(n) && n >= 0)) continue;
		counties.set(countyKey(name), { rep, dem, npa, oth: 0, total: rep + dem + npa });
	}
	const times = [...html.matchAll(/Last updated:\s*(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/g)]
		.map((m) => new Date(`${m[1]}T${m[2]}-05:00`))
		.filter((d) => !Number.isNaN(d.getTime()));
	const latest = times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
	return { updated: latest?.toISOString() ?? null, counties };
}

export async function fetchFreshTake(): Promise<FreshTakeEday> {
	const page = await sourceText(FRESHTAKE_URL, 3_000_000);
	return parseFreshTake(page.text);
}
