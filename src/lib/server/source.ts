import { fromCrossJSON } from 'seroval';
import { parseLiteral } from './literal.ts';

export const SOURCE_URL = 'https://acorn-maple-earth-lake.grok.me/';

export async function fetchSource(signal: AbortSignal): Promise<Record<string, unknown>> {
	const request = async (url: string | URL, headers: Record<string, string>) => {
		const response = await fetch(url, { headers, signal });
		if (!response.ok) throw new Error(`Source responded ${response.status}`);
		return response;
	};
	const html = await (
		await request(SOURCE_URL, {
			'user-agent': 'Mozilla/5.0 (fl-voting-estimations)',
			accept: 'text/html'
		})
	).text();
	const anchor = html.indexOf('{fetchedAt:');
	if (anchor >= 0) return parseLiteral(html, anchor) as Record<string, unknown>;
	const script = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
		.map((match) => new URL(match[1], SOURCE_URL))
		.find(
			(url) => url.origin === new URL(SOURCE_URL).origin && url.pathname.startsWith('/assets/')
		);
	if (!script) throw new Error('Could not find source data script');
	const javascript = await (await request(script, { accept: 'text/javascript' })).text();
	const name = javascript.match(/await\s+(\w+)\(\{data:\{force:/)?.[1];
	const id = name
		? javascript.match(
				new RegExp(
					name +
						'=\\w+\\(\\{method:[`"\x27]GET[`"\x27]\\}\\)\\.handler\\(\\w+\\([`"\x27]([a-f0-9]{64})'
				)
			)?.[1]
		: undefined;
	if (!id) throw new Error('Could not find source turnout endpoint');
	const response = await request(new URL(`/_serverFn/${id}`, SOURCE_URL), {
		accept: 'application/json',
		'x-tsr-serverFn': 'true',
		'sec-fetch-site': 'same-origin'
	});
	const payload = fromCrossJSON(await response.json(), { refs: new Map() }) as {
		result?: Record<string, unknown>;
		error?: unknown;
	};
	if (payload.error || !payload.result) throw new Error('Source turnout endpoint returned no data');
	return payload.result;
}
