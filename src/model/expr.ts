// Small, safe expression evaluator for parametric values (no eval()).
// Supports + - * / ^, parentheses, numbers, variables, pi, and sin cos tan sqrt abs min max round.
// Trig functions take degrees, as CAD users expect.

const FN: Record<string, (...a: number[]) => number> = {
  sin: (d) => Math.sin((d * Math.PI) / 180), cos: (d) => Math.cos((d * Math.PI) / 180),
  tan: (d) => Math.tan((d * Math.PI) / 180), sqrt: Math.sqrt, abs: Math.abs,
  min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil,
};

type Tok = { t: 'n'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function lex(s: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { const m = /^[0-9]*\.?[0-9]+(e[-+]?[0-9]+)?/i.exec(s.slice(i)) || /^[0-9]+\.?/.exec(s.slice(i)); if (!m) throw new Error('Bad number'); out.push({ t: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))!; out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

export class Evaluator {
  private cache = new Map<string, number>();
  private stack = new Set<string>();
  constructor(private vars: Record<string, string>) {}

  variable(name: string): number {
    if (this.cache.has(name)) return this.cache.get(name)!;
    if (!(name in this.vars)) throw new Error(`Unknown variable "${name}"`);
    if (this.stack.has(name)) throw new Error(`Circular reference in "${name}"`);
    this.stack.add(name);
    const v = this.eval(this.vars[name]);
    this.stack.delete(name);
    this.cache.set(name, v);
    return v;
  }

  eval(src: string | number | undefined): number {
    if (typeof src === 'number') return src;
    if (src == null || String(src).trim() === '') return 0;
    const toks = lex(String(src)); let p = 0;
    const peek = () => toks[p];
    const take = (v?: string) => { const t = toks[p++]; if (v && (!t || t.v !== v)) throw new Error(`Expected "${v}"`); return t; };
    const expr = (): number => { let v = term(); while (peek() && (peek().v === '+' || peek().v === '-')) { const o = take().v; const r = term(); v = o === '+' ? v + r : v - r; } return v; };
    const term = (): number => { let v = power(); while (peek() && (peek().v === '*' || peek().v === '/')) { const o = take().v; const r = power(); v = o === '*' ? v * r : v / r; } return v; };
    const power = (): number => { const b = unary(); if (peek() && peek().v === '^') { take(); return Math.pow(b, power()); } return b; };
    const unary = (): number => { if (peek() && peek().v === '-') { take(); return -unary(); } if (peek() && peek().v === '+') { take(); return unary(); } return atom(); };
    const atom = (): number => {
      const t = take(); if (!t) throw new Error('Unexpected end');
      if (t.t === 'n') return t.v;
      if (t.t === 'op' && t.v === '(') { const v = expr(); take(')'); return v; }
      if (t.t === 'id') {
        if (t.v === 'pi' || t.v === 'PI') return Math.PI;
        if (peek() && peek().v === '(') {
          const f = FN[t.v]; if (!f) throw new Error(`Unknown function "${t.v}"`);
          take('('); const args = [expr()]; while (peek() && peek().v === ',') { take(); args.push(expr()); } take(')');
          return f(...args);
        }
        return this.variable(t.v);
      }
      throw new Error(`Unexpected "${t.v}"`);
    };
    const v = expr();
    if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
    if (!isFinite(v)) throw new Error('Result is not a number');
    return v;
  }
}

export function tryEval(vars: Record<string, string>, src: string): { ok: true; v: number } | { ok: false; err: string } {
  try { return { ok: true, v: new Evaluator(vars).eval(src) }; } catch (e: any) { return { ok: false, err: e.message }; }
}
