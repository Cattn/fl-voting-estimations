import { error } from '@sveltejs/kit';
import { getFeed } from '#lib/server/feed.ts';
import { EV_END } from '#lib/model.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders, depends }) => {
	depends('app:feed');
	setHeaders({ 'cache-control': 'no-store' });
	try {
		const feed = await getFeed();
		return {
			feed: {
				...feed,
				earlyDays: feed.earlyDays.filter((d) => d.date <= EV_END),
				mailDays: feed.mailDays.filter((d) => d.date <= EV_END)
			}
		};
	} catch (e) {
		error(502, `Could not load early-voting archive: ${(e as Error).message}`);
	}
};
