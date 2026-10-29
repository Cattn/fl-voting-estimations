import { ELECTION_DAY, EV_END } from './model.ts';
import { POLLS_CLOSE, POLLS_OPEN, type Phase } from './election.ts';

export const UI_SWITCH_DATE = '2026-11-02';
export const ELECTION_MIDNIGHT = Date.parse(`${ELECTION_DAY}T00:00:00-05:00`);
export const UI_SWITCH_AT = Date.parse(`${UI_SWITCH_DATE}T00:00:00-05:00`);
export const ALL_POLLS_CLOSED_AT = ELECTION_MIDNIGHT + (POLLS_CLOSE + 60) * 60_000;
export const CERTIFICATION_DATE = '2026-11-17';

const clock = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'America/New_York',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

export function electionClock(now = new Date()) {
	const p = Object.fromEntries(clock.formatToParts(now).map((p) => [p.type, p.value]));
	const date = `${p.year}-${p.month}-${p.day}`;
	const localMinute = Number(p.hour) * 60 + Number(p.minute);
	const day =
		(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${ELECTION_DAY}T00:00:00Z`)) / 86_400_000;
	const minute = day * 1440 + localMinute;
	const phase: Phase =
		date < ELECTION_DAY || minute < POLLS_OPEN
			? 'pre'
			: minute < POLLS_CLOSE + 60
				? 'open'
				: 'closed';
	const next =
		[UI_SWITCH_AT, ELECTION_MIDNIGHT + POLLS_OPEN * 60_000, ALL_POLLS_CLOSED_AT].find(
			(at) => at > now.getTime()
		) ?? null;
	return { now: now.toISOString(), date, minute, phase, earlyVoting: date <= EV_END, next };
}

export function electionHome(now = new Date()): string | null {
	const c = electionClock(now);
	if (c.earlyVoting) return null;
	return c.phase === 'closed' ? '/election-day/state' : '/election-day';
}
