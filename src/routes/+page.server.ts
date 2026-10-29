import { error, redirect } from '@sveltejs/kit';
import { getFeed } from '#lib/server/feed.ts';
import { floridaClock } from '#lib/model.ts';
import { electionHome } from '#lib/election-clock.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, setHeaders, parent, url }) => {
	depends('app:feed');
	const { serverClock } = await parent();
	const destination = electionHome(new Date(serverClock.now));
	if (destination) redirect(307, `${destination}${url.search}`);
	try {
		const feed = await getFeed();
		setHeaders({ 'cache-control': 'no-store' });
		return { feed, clock: floridaClock(new Date(serverClock.now)) };
	} catch (e) {
		error(502, `Could not load turnout data: ${(e as Error).message}`);
	}
};
