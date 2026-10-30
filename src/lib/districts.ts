import { DISTRICT_PARTS } from './district-parts.ts';
import { marginOf } from './model.ts';
import { DISTRICTS, PRES_2024 } from './results.ts';
import type { PartyCounts } from './types.ts';

export interface AreaCounts {
	code: string;
	name: string;
	registered: number;
	ipev: PartyCounts;
	mail: PartyCounts | null;
	total: PartyCounts | null;
}

export interface DistrictCounts {
	n: number;
	registered: number;
	ipev: PartyCounts;
	mail: PartyCounts | null;
	total: PartyCounts | null;
	trump24: number;
	wholeShare: number;
	counties: { name: string; share: number }[];
}

const ZERO: PartyCounts = { rep: 0, dem: 0, npa: 0, oth: 0, total: 0 };

const add = (a: PartyCounts, b: PartyCounts): PartyCounts => ({
	rep: a.rep + b.rep,
	dem: a.dem + b.dem,
	npa: a.npa + b.npa,
	oth: a.oth + b.oth,
	total: a.total + b.total
});

export const MAX_LEAN_OFFSET = 40;

function pieces(c: PartyCounts, parts: { share: number; marginShift: number }[]): PartyCounts[] {
	const bound = (gap: number, twoParty: number) => Math.max(-twoParty, Math.min(twoParty, gap));
	const gaps = parts.map(({ share, marginShift }) =>
		bound((c.dem - c.rep) * share + (marginShift * c.total * share) / 100, (c.rep + c.dem) * share)
	);
	const residual = c.dem - c.rep - gaps.reduce((a, g) => a + g, 0);
	return parts.map(({ share }, i) => {
		const twoParty = (c.rep + c.dem) * share;
		const gap = bound(gaps[i] + residual * share, twoParty);
		return {
			rep: (twoParty - gap) / 2,
			dem: (twoParty + gap) / 2,
			npa: c.npa * share,
			oth: c.oth * share,
			total: c.total * share
		};
	});
}

function slope(points: { x: number; y: number; w: number }[]): number {
	const w = points.reduce((a, p) => a + p.w, 0);
	if (!w) return 0;
	const mx = points.reduce((a, p) => a + p.w * p.x, 0) / w;
	const my = points.reduce((a, p) => a + p.w * p.y, 0) / w;
	const cov = points.reduce((a, p) => a + p.w * (p.x - mx) * (p.y - my), 0);
	const variance = points.reduce((a, p) => a + p.w * (p.x - mx) ** 2, 0);
	return variance ? cov / variance : 0;
}

const countyPop = new Map<string, number>();
const districtPop = new Map<number, number>();
for (const [d, county, pop] of DISTRICT_PARTS) {
	countyPop.set(county, (countyPop.get(county) ?? 0) + pop);
	districtPop.set(d, (districtPop.get(d) ?? 0) + pop);
}

export function partLeans(leanOf: (county: string) => number): Map<string, number> {
	const trump = new Map(DISTRICTS.map((d) => [d.n, d.trump24]));
	const a = new Map<string, number>();
	const b = new Map<number, number>([...districtPop.keys()].map((d) => [d, 0]));
	const fitCounties = () => {
		for (const county of countyPop.keys()) {
			const shifted = DISTRICT_PARTS.filter((p) => p[1] === county).reduce(
				(sum, [d, , pop]) => sum + (pop / countyPop.get(county)!) * b.get(d)!,
				0
			);
			a.set(county, leanOf(county) - shifted);
		}
	};
	for (let i = 0; i < 200; i++) {
		fitCounties();
		for (const d of districtPop.keys()) {
			const base = DISTRICT_PARTS.filter((p) => p[0] === d).reduce(
				(sum, [, county, pop]) => sum + (pop / districtPop.get(d)!) * a.get(county)!,
				0
			);
			b.set(d, (trump.get(d) ?? 0) - base);
		}
	}
	fitCounties();
	return new Map(
		DISTRICT_PARTS.map(([d, county]) => [`${d}|${county}`, a.get(county)! + b.get(d)!])
	);
}

export function apportionDistricts(areas: AreaCounts[]): DistrictCounts[] {
	const byName = new Map(areas.map((a) => [a.name, a]));
	const leanOf = (county: string) => PRES_2024[byName.get(county)?.code ?? ''] ?? 0;
	const leans = partLeans(leanOf);
	const splitCounties = new Set(
		[...countyPop.keys()].filter((c) => DISTRICT_PARTS.filter((p) => p[1] === c).length > 1)
	);
	const k = (pick: (a: AreaCounts) => PartyCounts | null) =>
		slope(
			areas.flatMap((a) => {
				const c = pick(a);
				return c?.total ? [{ x: leanOf(a.name), y: marginOf(c), w: c.total }] : [];
			})
		);
	const trump = new Map(DISTRICTS.map((d) => [d.n, d.trump24]));

	const splitMetric = (pick: (a: AreaCounts) => PartyCounts | null) => {
		const slopeK = k(pick);
		const out = new Map<string, PartyCounts>();
		for (const county of countyPop.keys()) {
			const area = byName.get(county);
			const c = area && pick(area);
			if (!c) continue;
			const parts = DISTRICT_PARTS.filter((p) => p[1] === county);
			const offsets = parts.map(([d]) =>
				Math.max(
					-MAX_LEAN_OFFSET,
					Math.min(MAX_LEAN_OFFSET, leans.get(`${d}|${county}`)! - leanOf(county))
				)
			);
			pieces(
				c,
				parts.map(([, , pop], i) => ({
					share: pop / countyPop.get(county)!,
					marginShift: slopeK * offsets[i]
				}))
			).forEach((counts, i) => out.set(`${parts[i][0]}|${county}`, counts));
		}
		return out;
	};
	const anyMail = areas.some((a) => a.mail);
	const split = {
		ipev: splitMetric((a) => a.ipev),
		mail: anyMail ? splitMetric((a) => a.mail) : null,
		total: anyMail ? splitMetric((a) => a.total) : null
	};

	return [...districtPop.keys()]
		.sort((x, y) => x - y)
		.map((n) => {
			const parts = DISTRICT_PARTS.filter((p) => p[0] === n);
			const sum = (m: Map<string, PartyCounts> | null) =>
				m &&
				parts.reduce((acc, [, county]) => {
					const c = m.get(`${n}|${county}`);
					return c ? add(acc, c) : acc;
				}, ZERO);
			return {
				n,
				registered: parts.reduce(
					(acc, [, county, pop]) =>
						acc + (byName.get(county)?.registered ?? 0) * (pop / countyPop.get(county)!),
					0
				),
				ipev: sum(split.ipev) ?? ZERO,
				mail: sum(split.mail),
				total: sum(split.total),
				trump24: trump.get(n) ?? 0,
				wholeShare:
					parts.filter(([, county]) => !splitCounties.has(county)).reduce((a, p) => a + p[2], 0) /
					districtPop.get(n)!,
				counties: parts.map(([, county, pop]) => ({
					name: county,
					share: pop / districtPop.get(n)!
				}))
			};
		});
}
