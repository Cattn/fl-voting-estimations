import { parseResults, PRES_2024, RESULTS_URL } from '../results.ts';
import type { CountyReporting } from '../live.ts';
import type { FeedData, PartyCounts } from '../types.ts';
import { electionClock } from '../election-clock.ts';
import { addCounts } from '../election.ts';
import { sourceText } from './http.ts';

export const REPORTING_URL = 'https://floridaelectionwatch.gov/CountyReportingStatus';
export const DOWNLOADS_URL = 'https://floridaelectionwatch.gov/Downloads';
const counties = Object.keys(PRES_2024);
const clean = (s: string) =>
	s
		.replace(/<[^>]*>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export function validateTurnout(feed: FeedData, now = new Date()): string[] {
	if (feed.stale) throw new Error(feed.stale);
	if (
		feed.counties.length !== 67 ||
		new Set(feed.counties.map((c) => c.code)).size !== 67 ||
		feed.counties.some((c) => !counties.includes(c.code))
	)
		throw new Error('Turnout source is missing counties');
	if (electionClock(now).minute >= 7 * 60 && (!feed.eday || feed.counties.some((c) => !c.eday)))
		throw new Error('Election Day party turnout is missing');
	if (Date.parse(feed.fetchedAt) > now.getTime() + 5 * 60_000)
		throw new Error('Turnout source timestamp is in the future');
	if (now.getTime() - Date.parse(feed.fetchedAt) > 20 * 60_000)
		throw new Error('Turnout source timestamp is stale');
	const warnings: string[] = [];
	if (feed.partial || (feed.received !== undefined && feed.received !== 67))
		warnings.push(
			`Turnout source is still updating (${feed.received ?? 'unknown'}/67 counties); turnout projections are paused.`
		);
	if (feed.counties.some((c) => !Number.isFinite(c.registered) || c.registered <= 0))
		throw new Error('Invalid county registration');
	for (const method of ['early', 'mail', 'eday'] as const) {
		const statewide = feed[method];
		if (!statewide) continue;
		const sum = addCounts(
			...feed.counties.map((c) => c[method] ?? { rep: 0, dem: 0, npa: 0, oth: 0, total: 0 })
		);
		for (const row of [
			statewide,
			...feed.counties.map((c) => c[method]).filter((p): p is PartyCounts => !!p)
		])
			if (Math.abs(row.total - row.rep - row.dem - row.npa - row.oth) > 1)
				throw new Error(`Invalid ${method} party totals`);
		if (
			Object.keys(sum).some(
				(k) => Math.abs(sum[k as keyof PartyCounts] - statewide[k as keyof PartyCounts]) > 67
			)
		)
			warnings.push(
				`${method} statewide and county totals differ; turnout projections are paused.`
			);
	}
	return warnings;
}

export function parseReporting(html: string, feed: FeedData): CountyReporting[] {
	if (!html.includes('County Reporting Status') || !html.includes('2026'))
		throw new Error('Unexpected reporting-status page');
	const rows: CountyReporting[] = [];
	for (const [, body] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
		const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
		if (cells.length < 10) continue;
		const c = feed.counties.find((c) => normalize(c.name) === normalize(clean(cells[0])));
		if (!c) continue;
		const num = (i: number) => {
			const s = clean(cells[i]).replace(/,/g, '');
			if (!/^\d+$/.test(s)) throw new Error('Invalid reporting-status number');
			return Number(s);
		};
		const complete = (i: number) =>
			/class\s*=\s*["']?Y(?:[\s"'>]|$)/i.test(cells[i]) ||
			/^(yes|complete|completed)$/i.test(clean(cells[i]));
		rows.push({
			code: c.code,
			turnout: num(1),
			registered: num(2),
			precinctsComplete: complete(5),
			mailComplete: complete(6),
			earlyComplete: complete(7),
			provisionalComplete: complete(8),
			overseasComplete: complete(9)
		});
	}
	if (rows.length !== 67 || new Set(rows.map((r) => r.code)).size !== 67)
		throw new Error('Reporting-status source is missing counties');
	return rows;
}

export async function fetchResults(now = new Date()) {
	let url = RESULTS_URL;
	if (electionClock(now).date > '2026-11-03') {
		const page = await sourceText(DOWNLOADS_URL);
		const links = [...page.text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(
			(m) => new URL(m[1], DOWNLOADS_URL)
		);
		const file = links.find(
			(u) =>
				u.hostname === 'flelectionfiles.floridados.gov' &&
				/20261103.*ElecResultsFL\.txt$/i.test(u.pathname)
		);
		if (!file) throw new Error('Could not verify the current official results download');
		url = file.href;
	}
	const response = await sourceText(url);
	if (!response.text.split(/\r?\n/, 1)[0].includes('ElectionDate'))
		throw new Error('Results file is missing election identity');
	const rows = parseResults(response.text).filter((r) =>
		['GOV', 'USS', 'USR', 'ATG', 'CFO', 'AGR', 'AMD'].includes(r.race)
	);
	for (const race of ['GOV', 'USS', 'ATG', 'CFO', 'AGR']) {
		const reports = new Set(rows.filter((r) => r.race === race).map((r) => r.county));
		if (reports.size !== 67) throw new Error(`Incomplete ${race} results file`);
	}
	if (rows.some((r) => !counties.includes(r.county)))
		throw new Error('Results contain an unknown county');
	return { rows, url, updated: response.modified };
}
