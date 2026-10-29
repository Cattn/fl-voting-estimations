import { error, redirect } from '@sveltejs/kit';
import { getElectionSnapshot } from '#lib/server/election-feed.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ setHeaders, depends, parent }) => {
	depends('app:election');
	const { serverClock } = await parent();
	if (serverClock.earlyVoting) redirect(307, '/');
	try {
		setHeaders({ 'cache-control': 'no-store' });
		const snapshot = await getElectionSnapshot();
		return { snapshot };
	} catch (e) {
		error(502, `Could not load turnout data: ${(e as Error).message}`);
	}
};
