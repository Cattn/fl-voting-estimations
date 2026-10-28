export function parseLiteral(src: string, start: number): unknown {
	const refs = new Map<number, unknown>();
	let i = start;

	const fail = (msg: string): never => {
		throw new Error(`${msg} at offset ${i}: ${src.slice(i, i + 40)}`);
	};
	const ws = () => {
		while (i < src.length && /\s/.test(src[i])) i++;
	};
	const eat = (s: string) => {
		if (src.startsWith(s, i)) {
			i += s.length;
			return true;
		}
		return false;
	};

	const parseString = (): string => {
		const quote = src[i++];
		let out = '';
		while (i < src.length && src[i] !== quote) {
			const c = src[i++];
			if (c !== '\\') {
				out += c;
				continue;
			}
			const e = src[i++];
			if (e === 'n') out += '\n';
			else if (e === 't') out += '\t';
			else if (e === 'r') out += '\r';
			else if (e === 'b') out += '\b';
			else if (e === 'f') out += '\f';
			else if (e === 'v') out += '\v';
			else if (e === '0') out += '\0';
			else if (e === 'u') {
				out += String.fromCharCode(parseInt(src.slice(i, i + 4), 16));
				i += 4;
			} else if (e === 'x') {
				out += String.fromCharCode(parseInt(src.slice(i, i + 2), 16));
				i += 2;
			} else out += e;
		}
		if (src[i] !== quote) fail('Unterminated string');
		i++;
		return out;
	};

	const parseKey = (): string => {
		ws();
		if (src[i] === '"' || src[i] === "'") return parseString();
		const m = /^[A-Za-z_$][\w$]*|^\d+/.exec(src.slice(i, i + 200));
		if (!m) fail('Bad object key');
		i += m![0].length;
		return m![0];
	};

	const parseValue = (): unknown => {
		ws();
		const refAssign = /^\$R\[(\d+)\]/.exec(src.slice(i, i + 20));
		if (refAssign) {
			i += refAssign[0].length;
			const id = Number(refAssign[1]);
			if (src[i] === '=') {
				i++;
				const v = parseValue();
				refs.set(id, v);
				return v;
			}
			if (!refs.has(id)) fail(`Unresolved reference $R[${id}]`);
			return refs.get(id);
		}
		const c = src[i];
		if (c === '{') {
			i++;
			const obj: Record<string, unknown> = {};
			ws();
			if (eat('}')) return obj;
			for (;;) {
				const k = parseKey();
				ws();
				if (!eat(':')) fail('Expected :');
				obj[k] = parseValue();
				ws();
				if (eat(',')) continue;
				if (eat('}')) return obj;
				fail('Expected , or }');
			}
		}
		if (c === '[') {
			i++;
			const arr: unknown[] = [];
			ws();
			if (eat(']')) return arr;
			for (;;) {
				arr.push(parseValue());
				ws();
				if (eat(',')) continue;
				if (eat(']')) return arr;
				fail('Expected , or ]');
			}
		}
		if (c === '"' || c === "'") return parseString();
		if (eat('!0')) return true;
		if (eat('!1')) return false;
		if (eat('null')) return null;
		if (eat('void 0')) return undefined;
		if (eat('NaN')) return NaN;
		if (eat('-Infinity')) return -Infinity;
		if (eat('Infinity')) return Infinity;
		if (eat('new Date(')) {
			ws();
			const d = parseString();
			ws();
			if (!eat(')')) fail('Expected )');
			return d;
		}
		const num = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i, i + 40));
		if (num) {
			i += num[0].length;
			return Number(num[0]);
		}
		return fail('Unexpected token');
	};

	return parseValue();
}
