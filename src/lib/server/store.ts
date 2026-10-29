import { env, waitUntil } from './bindings.ts';
import type { FeedData } from '#lib/types.ts';
import type { ElectionRecord } from '#lib/live.ts';

const KEY = 'feed:v1';

export interface Snapshot {
	at: number;
	data: FeedData;
	election?: ElectionRecord;
}

const kv = () => (env as Cloudflare.Env).FEED_CACHE;

export async function loadSnapshot(): Promise<Snapshot | null> {
	try {
		return ((await kv()?.get(KEY, 'json')) as Snapshot | null) ?? null;
	} catch {
		return null;
	}
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
	const binding = kv();
	if (!binding) throw new Error('FEED_CACHE binding is missing');
	const body = JSON.stringify(snapshot);
	if (new TextEncoder().encode(body).byteLength > 1_500_000)
		throw new Error('Published snapshot exceeded storage budget');
	await binding.put(KEY, body);
}

export function runInBackground(task: Promise<unknown>) {
	try {
		waitUntil(task);
	} catch {
		return;
	}
}
