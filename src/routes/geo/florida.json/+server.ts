import { json } from '@sveltejs/kit';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import counties from 'us-atlas/counties-10m.json';
import type { RequestHandler } from './$types';

export const prerender = true;

export const GET: RequestHandler = () => {
	const topo = counties as unknown as Topology<{ counties: GeometryCollection<{ name: string }> }>;
	const fl = {
		...topo.objects.counties,
		geometries: topo.objects.counties.geometries.filter((g) => String(g.id).startsWith('12'))
	};
	return json(feature(topo, fl));
};
