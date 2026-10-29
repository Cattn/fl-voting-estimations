export async function sourceText(
	url: string,
	maxBytes = 2_000_000,
	timeoutMs = 8_000
): Promise<{ text: string; modified: string | null }> {
	const response = await fetch(url, {
		headers: {
			'user-agent': 'Mozilla/5.0 (fl-voting-estimations)',
			accept: 'text/html,text/plain,*/*'
		},
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!response.ok) throw new Error(`Source responded ${response.status}`);
	return {
		text: await responseText(response, maxBytes),
		modified: response.headers.get('last-modified')
	};
}

export async function responseText(response: Response, maxBytes = 2_000_000): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error('Source response has no body');
	const decoder = new TextDecoder();
	let text = '';
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) throw new Error('Source response exceeded size limit');
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
	} finally {
		await reader.cancel();
	}
	return text;
}
