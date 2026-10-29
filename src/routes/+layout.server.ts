import { electionClock } from '#lib/election-clock.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => ({ serverClock: electionClock() });
