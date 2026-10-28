import { env, waitUntil } from 'cloudflare:workers';
import type { FeedData } from '#lib/types.ts';

const KEY = 'feed:v1';

export interface Snapshot {
	at: number;
	data: FeedData;
}

type Bindings = { FEED_CACHE?: KVNamespace };

const kv = () => (env as Bindings).FEED_CACHE;

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
	await binding.put(KEY, JSON.stringify(snapshot));
}

export function runInBackground(task: Promise<unknown>) {
	try {
		waitUntil(task);
	} catch {
		return;
	}
}
