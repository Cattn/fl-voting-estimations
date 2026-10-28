export interface Palette {
	surface: string;
	ink: string;
	ink2: string;
	muted: string;
	grid: string;
	axis: string;
	dem: string;
	rep: string;
	neutral: string;
	seq: string[];
}

const light: Palette = {
	surface: '#fcfcfb',
	ink: '#0b0b0b',
	ink2: '#52514e',
	muted: '#898781',
	grid: '#e1e0d9',
	axis: '#c3c2b7',
	dem: '#2a78d6',
	rep: '#e34948',
	neutral: '#f0efec',
	seq: ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b']
};

const dark: Palette = {
	surface: '#1a1a19',
	ink: '#f0efec',
	ink2: '#c3c2b7',
	muted: '#898781',
	grid: '#2c2c2a',
	axis: '#383835',
	dem: '#3987e5',
	rep: '#e66767',
	neutral: '#383835',
	seq: ['#104281', '#1c5cab', '#3987e5', '#86b6ef', '#cde2fb']
};

type Mode = 'light' | 'dark';

class Theme {
	mode = $state<Mode>('dark');
	palette = $derived(this.mode === 'dark' ? dark : light);

	init() {
		const saved = localStorage.getItem('theme') as Mode | null;
		const media = matchMedia('(prefers-color-scheme: dark)');
		this.set(saved ?? (media.matches ? 'dark' : 'light'), false);
		media.addEventListener('change', (e) => {
			if (!localStorage.getItem('theme')) this.set(e.matches ? 'dark' : 'light', false);
		});
	}

	set(mode: Mode, persist = true) {
		this.mode = mode;
		document.documentElement.dataset.theme = mode;
		if (persist) localStorage.setItem('theme', mode);
	}

	toggle() {
		this.set(this.mode === 'dark' ? 'light' : 'dark');
	}
}

export const theme = new Theme();
