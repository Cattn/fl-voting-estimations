import { viewElection } from '#lib/view-election.ts';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data, parent }) => {
	const inherited = await parent();
	const { serverClock } = inherited;
	const now = new Date(serverClock.now);
	const election = viewElection(data.snapshot, now);
	return { ...data, feed: data.snapshot.data, minute: election.state.minute, election };
};
