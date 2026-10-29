import { env } from './bindings.ts';
import { ELECTION_ID, type ElectionSnapshot } from '../live.ts';
import { electionClock } from '../election-clock.ts';
import { saveSnapshot } from './store.ts';

export const MAX_DATABASE_BYTES = 25_000_000;
export const MAX_SNAPSHOT_BYTES = 1_500_000;
export const COLLECTION_INTERVAL = 3 * 60_000;
const key = `live:${ELECTION_ID}`;
const database = () => (env as Cloudflare.Env).ELECTION_HISTORY;

export async function loadElectionDatabase(): Promise<ElectionSnapshot | null> {
	const db = database();
	if (!db) return null;
	try {
		const row = await db
			.prepare('SELECT body FROM election_records WHERE key = ?')
			.bind(key)
			.first<{ body: string }>();
		return row ? (JSON.parse(row.body) as ElectionSnapshot) : null;
	} catch (e) {
		if ((e as Error).message.includes('no such table')) return null;
		throw e;
	}
}

export async function persistElection(
	snapshot: ElectionSnapshot,
	previousAt: number | null
): Promise<boolean> {
	const db = database();
	if (!db) throw new Error('ELECTION_HISTORY binding is missing');
	const body = JSON.stringify(snapshot);
	if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES)
		throw new Error('Election snapshot exceeded storage budget');
	const schema = await db
		.prepare(
			'CREATE TABLE IF NOT EXISTS election_records (key TEXT PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL) WITHOUT ROWID'
		)
		.run();
	if (schema.meta.size_after + body.length * 4 > MAX_DATABASE_BYTES)
		throw new Error('Election history reached its storage budget');
	const date = electionClock(new Date(snapshot.at)).date;
	const archive = JSON.stringify({
		at: snapshot.at,
		data: snapshot.data,
		results: snapshot.election.results,
		sources: snapshot.election.sources
	});
	const results = await db.batch([
		db
			.prepare(
				'INSERT INTO election_records (key, at, body) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body WHERE election_records.at = ? AND election_records.at < excluded.at'
			)
			.bind(key, snapshot.at, body, previousAt ?? -1),
		db
			.prepare(
				'INSERT INTO election_records (key, at, body) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM election_records WHERE key = ? AND at = ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, body = excluded.body WHERE election_records.at < excluded.at'
			)
			.bind(`archive:${ELECTION_ID}:${date}`, snapshot.at, archive, key, snapshot.at),
		db
			.prepare(
				'DELETE FROM election_records WHERE key LIKE ? AND key NOT IN (SELECT key FROM election_records WHERE key LIKE ? ORDER BY at DESC LIMIT 32)'
			)
			.bind(`archive:${ELECTION_ID}:%`, `archive:${ELECTION_ID}:%`)
	]);
	if (!results[0].meta.changes) return false;
	await saveSnapshot(snapshot);
	console.log({
		event: 'election_storage',
		rows_written: results.reduce((sum, r) => sum + r.meta.rows_written, 0),
		database_bytes: results.at(-1)?.meta.size_after,
		published_bytes: new TextEncoder().encode(body).byteLength
	});
	return true;
}
