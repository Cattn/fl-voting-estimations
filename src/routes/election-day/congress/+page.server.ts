import { error } from '@sveltejs/kit';
import { getElectionSnapshot } from '#lib/server/election-feed.ts';
import { viewElection } from '#lib/view-election.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, parent }) => {
	depends('app:election');
	const { serverClock } = await parent();
	try {
		const snapshot = await getElectionSnapshot();
		return {
			results: snapshot.election.results,
			projectable: viewElection(snapshot, new Date(serverClock.now)).projectable
		};
	} catch (e) {
		error(502, `Could not load results: ${(e as Error).message}`);
	}
};
