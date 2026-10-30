import { json } from '@sveltejs/kit';
import districts from '#lib/geo/florida-cd-2026.json';
import type { RequestHandler } from './$types';

export const prerender = true;

export const GET: RequestHandler = () => json(districts);
