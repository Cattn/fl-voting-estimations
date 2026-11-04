export interface PartyCounts {
	rep: number;
	dem: number;
	npa: number;
	oth: number;
	total: number;
}

export interface County {
	code: string;
	name: string;
	registered: number;
	mail: PartyCounts;
	early: PartyCounts;
	eday?: PartyCounts;
	updated?: string;
	edayUpdated?: string;
	heldSince?: string;
	status?: string;
}

export interface CountyDayCounts extends PartyCounts {
	code: string;
}

export interface DayCounts extends PartyCounts {
	date: string;
	retained?: boolean;
	counties?: CountyDayCounts[];
}

export interface RaceCalls {
	checkedAt: number;
	races: Record<string, { name: string; lastName: string; party: string }>;
}

export interface StatewideRace {
	race: string;
	title: string;
	reporting: number;
	precincts: number;
	counties: number;
	candidates: { name: string; party: string; votes: number }[];
}

export interface FeedData {
	source: string;
	stale?: string;
	partial?: boolean;
	received?: number;
	fetchedAt: string;
	windowOpen: boolean;
	registered: number;
	mail: PartyCounts;
	early: PartyCounts;
	eday?: PartyCounts;
	outstanding: PartyCounts;
	statewide?: { updated: string | null; races: StatewideRace[] };
	counties: County[];
	earlyDays: DayCounts[];
	mailDays: DayCounts[];
	lastReportedMail?: DayCounts;
}

export interface ForecastDay {
	date: string;
	volume: number;
	margin: number;
}

export interface Forecast {
	modelVersion?: number;
	name: string;
	target: number;
	edMargin: number;
	edTurnout: number;
	mailFinal: number;
	mailRemaining?: number;
	mailMargin: number;
	days: ForecastDay[];
	today?: ForecastDay;
	linked?: boolean;
	balance?: 'adaptive' | 'ed' | 'ipev';
}
