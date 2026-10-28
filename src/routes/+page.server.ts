import { error } from '@sveltejs/kit';
import { getFeed } from '#lib/server/feed.ts';
import { floridaClock } from '#lib/model.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, setHeaders }) => {
	depends('app:feed');
	try {
		const feed = await getFeed();
		setHeaders({ 'cache-control': 'no-store' });
		return { feed, clock: floridaClock() };
	} catch (e) {
		error(502, `Could not load turnout data: ${(e as Error).message}`);
	}
};
