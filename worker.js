import app from './.svelte-kit/cloudflare/_worker.js';
import { refreshSnapshot } from './src/lib/server/feed.ts';

export default {
	fetch: app.fetch,
	async scheduled() {
		await refreshSnapshot();
	}
};
