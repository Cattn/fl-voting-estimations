import app from './.svelte-kit/cloudflare/_worker.js';
import { refreshElectionSnapshot } from './src/lib/server/election-feed.ts';

export default {
	fetch: app.fetch,
	async scheduled() {
		await refreshElectionSnapshot();
	}
};
