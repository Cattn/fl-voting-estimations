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
}
