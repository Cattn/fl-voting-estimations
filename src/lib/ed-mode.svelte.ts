const KEY = 'fl-ed-mode';

export const edMode = $state({ custom: false });

export function loadEdMode() {
	edMode.custom = localStorage.getItem(KEY) === 'forecast';
}

export function setEdMode(custom: boolean) {
	edMode.custom = custom;
	localStorage.setItem(KEY, custom ? 'forecast' : 'projection');
}
