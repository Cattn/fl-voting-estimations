import type { Forecast } from './types.ts';

const KEY = 'fl-ev-forecasts';

export function loadSaved(): Forecast[] {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(raw) ? raw : [];
	} catch {
		return [];
	}
}

export function storeSaved(list: Forecast[]) {
	localStorage.setItem(KEY, JSON.stringify(list));
}

export function encodeForecast(f: Forecast): string {
	const bytes = new TextEncoder().encode(JSON.stringify(f));
	let bin = '';
	bytes.forEach((b) => (bin += String.fromCharCode(b)));
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeForecast(s: string): Forecast | null {
	try {
		const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
		const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
		const f = JSON.parse(new TextDecoder().decode(bytes));
		if (typeof f?.edMargin !== 'number' || !Array.isArray(f?.days)) return null;
		return f as Forecast;
	} catch {
		return null;
	}
}
