import { SCRIPT_API_DTS } from '../../scripting/apiTypes';

export interface ApiMember {
  name: string;
  /** Full signature text as written in the .d.ts. */
  signature: string;
  doc?: string;
  kind: 'method' | 'property';
}

export interface ApiInterface {
  name: string;
  members: ApiMember[];
  doc?: string;
}

let cache: ApiInterface[] | null = null;

/**
 * Parse the scripting API declarations into interfaces and members. The
 * source is our own generated `.d.ts` text with a regular layout, so a
 * line-oriented parser is enough for completions and the docs sidebar.
 */
export function parseApi(dts: string = SCRIPT_API_DTS): ApiInterface[] {
  if (cache && dts === SCRIPT_API_DTS) return cache;
  const out: ApiInterface[] = [];
  const lines = dts.split('\n');
  let current: ApiInterface | null = null;
  let depth = 0;
  let pendingDoc: string | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const doc = /^\/\*\*\s*(.*?)\s*\*\/$/.exec(line);
    if (doc) { pendingDoc = doc[1]; continue; }
    if (!current) {
      const m = /^(?:declare\s+)?interface\s+(\w+)/.exec(line);
      if (m) {
        current = { name: m[1], members: [], doc: pendingDoc };
        pendingDoc = undefined;
        depth = count(line, '{') - count(line, '}');
        // Single-line interface body.
        const body = /\{(.*)\}\s*$/.exec(line);
        if (body && depth === 0) { for (const part of splitMembers(body[1])) pushMember(current, part, undefined); out.push(current); current = null; }
        continue;
      }
      const fn = /^declare function\s+(\w+)(.*);?$/.exec(line);
      if (fn) { out.push({ name: fn[1], doc: pendingDoc, members: [{ name: fn[1], signature: `${fn[1]}${fn[2].replace(/;$/, '')}`, doc: pendingDoc, kind: 'method' }] }); pendingDoc = undefined; }
      continue;
    }
    depth += count(line, '{') - count(line, '}');
    if (depth <= 0) { out.push(current); current = null; pendingDoc = undefined; continue; }
    for (const part of splitMembers(line)) pushMember(current, part, pendingDoc);
    pendingDoc = undefined;
  }
  if (current) out.push(current);
  if (dts === SCRIPT_API_DTS) cache = out;
  return out;
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** Split `a: number; b(): void;` at top-level semicolons. */
function splitMembers(line: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of line) {
    if (ch === '(' || ch === '{' || ch === '<' || ch === '[') depth++;
    if (ch === ')' || ch === '}' || ch === '>' || ch === ']') depth--;
    if (ch === ';' && depth === 0) { if (cur.trim()) parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function pushMember(iface: ApiInterface, text: string, doc: string | undefined): void {
  const m = /^(?:readonly\s+)?(\w+)\??\s*([(:<])/.exec(text);
  if (!m) return;
  const name = m[1];
  if (iface.members.some((x) => x.name === name)) return;
  iface.members.push({ name, signature: text, doc, kind: m[2] === '(' || m[2] === '<' ? 'method' : 'property' });
}

/** Return type name of a member signature, e.g. `transform: Transform` → `Transform`. */
export function memberType(sig: string): string | null {
  const m = /:\s*([A-Z]\w+)(?:\s*\|.*)?$/.exec(sig.replace(/\(.*\)\s*:/, ':'));
  return m ? m[1] : null;
}

/** Search interfaces and members by substring. */
export function searchApi(q: string, api = parseApi()): ApiInterface[] {
  const s = q.trim().toLowerCase();
  if (!s) return api;
  return api
    .map((i) => ({ ...i, members: i.name.toLowerCase().includes(s) ? i.members : i.members.filter((m) => m.name.toLowerCase().includes(s) || m.signature.toLowerCase().includes(s) || m.doc?.toLowerCase().includes(s)) }))
    .filter((i) => i.members.length || i.name.toLowerCase().includes(s));
}
