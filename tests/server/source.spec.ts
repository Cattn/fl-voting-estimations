import { afterEach, describe, expect, it, vi } from 'vitest';
import { toCrossJSON } from 'seroval';
import { fetchSource, SOURCE_URL } from '../../src/lib/server/source.ts';

afterEach(() => vi.unstubAllGlobals());

const id = 'a'.repeat(64);
const html = '<script type="module" src="/assets/index-new.js"></script>';
const script =
	'var XY=fn({method:`GET`}).handler(server(`' + id + '`));await XY({data:{force:false}})';

describe('source data transport', () => {
	it('discovers the current build endpoint and decodes its data and partial status', async () => {
		const data = { fetchedAt: '2026-10-28T23:00:00Z', partial: true, received: 66 };
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response(html))
			.mockResolvedValueOnce(new Response(script))
			.mockResolvedValueOnce(Response.json(toCrossJSON({ result: data }, { refs: new Map() })));
		vi.stubGlobal('fetch', fetch);
		expect(await fetchSource(new AbortController().signal)).toEqual(data);
		expect(String(fetch.mock.calls[1][0])).toBe(SOURCE_URL + 'assets/index-new.js');
		expect(String(fetch.mock.calls[2][0])).toBe(SOURCE_URL + '_serverFn/' + id);
		expect(fetch.mock.calls[2][1].headers).toMatchObject({
			accept: 'application/json',
			'x-tsr-serverFn': 'true',
			'sec-fetch-site': 'same-origin'
		});
	});

	it('still reads a source page containing embedded data', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('{fetchedAt:"now",windowOpen:!0}'));
		vi.stubGlobal('fetch', fetch);
		expect(await fetchSource(new AbortController().signal)).toEqual({
			fetchedAt: 'now',
			windowOpen: true
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('reports changed builds without requesting an old endpoint', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response(html))
			.mockResolvedValueOnce(new Response('changed'));
		vi.stubGlobal('fetch', fetch);
		await expect(fetchSource(new AbortController().signal)).rejects.toThrow(
			'Could not find source turnout endpoint'
		);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('rejects a server-function error instead of returning it as turnout data', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(new Response(html))
				.mockResolvedValueOnce(new Response(script))
				.mockResolvedValueOnce(
					Response.json(toCrossJSON({ error: 'unavailable' }, { refs: new Map() }))
				)
		);
		await expect(fetchSource(new AbortController().signal)).rejects.toThrow(
			'Source turnout endpoint returned no data'
		);
	});
});
