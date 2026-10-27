// Mini-langage des « custombinds » : conditions combinables sur le compte Roblox d'un membre.
// Exemple : (HasRank(123456, 10) or RankAtLeast(654321, 5)) and not InGroup(111) and HasBadge(222)
// Aucun eval : l'expression est analysée puis évaluée par un petit interpréteur.

export class CustomBindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomBindError';
  }
}

export type CustomBindNode =
  | { t: 'call'; name: string; args: string[] }
  | { t: 'not'; e: CustomBindNode }
  | { t: 'and' | 'or'; l: CustomBindNode; r: CustomBindNode };

export interface CustomBindContext {
  inGroup(groupId: string): Promise<boolean>;
  // Rang dans le groupe, 0 si le membre n'en fait pas partie
  rank(groupId: string): Promise<number>;
  hasItem(type: 'Asset' | 'Badge' | 'GamePass', id: string): Promise<boolean>;
}

const MAX_LENGTH = 500;
const MAX_DEPTH = 30;

const FUNCTIONS: Record<string, number> = {
  ingroup: 1,
  hasrank: 2,
  rankatleast: 2,
  hasrankatleast: 2,
  rankatmost: 2,
  hasrankatmost: 2,
  hasasset: 1,
  hasbadge: 1,
  hasgamepass: 1
};

type Token = { k: 'id' | 'num' | '(' | ')' | ',' | 'and' | 'or' | 'not'; v: string };

function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    const c = code[i];

    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')' || c === ',') { tokens.push({ k: c, v: c }); i++; continue; }
    if (c === '!') { tokens.push({ k: 'not', v: '!' }); i++; continue; }
    if (c === '&' && code[i + 1] === '&') { tokens.push({ k: 'and', v: '&&' }); i += 2; continue; }
    if (c === '|' && code[i + 1] === '|') { tokens.push({ k: 'or', v: '||' }); i += 2; continue; }

    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < code.length && /[0-9]/.test(code[j])) j++;
      tokens.push({ k: 'num', v: code.slice(i, j) });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < code.length && /[A-Za-z0-9_]/.test(code[j])) j++;
      const word = code.slice(i, j);
      const lower = word.toLowerCase();
      if (lower === 'and' || lower === 'or' || lower === 'not') tokens.push({ k: lower, v: lower });
      else tokens.push({ k: 'id', v: word });
      i = j;
      continue;
    }

    throw new CustomBindError(`Caractère inattendu « ${c} » (position ${i + 1})`);
  }

  return tokens;
}

export function parseCustomBind(code: string): CustomBindNode {
  if (!code.trim()) throw new CustomBindError('Le code est vide');
  if (code.length > MAX_LENGTH) throw new CustomBindError(`Le code est trop long (${MAX_LENGTH} caractères maximum)`);

  const tokens = tokenize(code);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (k: Token['k'], label: string) => {
    const token = next();
    if (!token || token.k !== k) throw new CustomBindError(`« ${label} » attendu`);
    return token;
  };

  function parseOr(depth: number): CustomBindNode {
    if (depth > MAX_DEPTH) throw new CustomBindError('Expression trop imbriquée');
    let left = parseAnd(depth);
    while (peek()?.k === 'or') {
      next();
      left = { t: 'or', l: left, r: parseAnd(depth) };
    }
    return left;
  }

  function parseAnd(depth: number): CustomBindNode {
    let left = parseUnary(depth);
    while (peek()?.k === 'and') {
      next();
      left = { t: 'and', l: left, r: parseUnary(depth) };
    }
    return left;
  }

  function parseUnary(depth: number): CustomBindNode {
    if (depth > MAX_DEPTH) throw new CustomBindError('Expression trop imbriquée');
    if (peek()?.k === 'not') {
      next();
      return { t: 'not', e: parseUnary(depth + 1) };
    }
    return parsePrimary(depth);
  }

  function parsePrimary(depth: number): CustomBindNode {
    const token = peek();
    if (!token) throw new CustomBindError('Expression incomplète');

    if (token.k === '(') {
      next();
      const inner = parseOr(depth + 1);
      expect(')', ')');
      return inner;
    }

    if (token.k === 'id') {
      next();
      const name = token.v.toLowerCase();
      const arity = FUNCTIONS[name];
      if (arity === undefined) {
        throw new CustomBindError(`Fonction inconnue : ${token.v}`);
      }
      expect('(', '(');
      const args: string[] = [];
      for (;;) {
        args.push(expect('num', 'un nombre').v);
        if (peek()?.k === ',') { next(); continue; }
        break;
      }
      expect(')', ')');
      if (args.length !== arity) {
        throw new CustomBindError(`${token.v} attend ${arity} argument${arity > 1 ? 's' : ''}`);
      }
      return { t: 'call', name, args };
    }

    throw new CustomBindError(`« ${token.v} » inattendu`);
  }

  const tree = parseOr(0);
  if (pos < tokens.length) throw new CustomBindError(`« ${tokens[pos].v} » inattendu`);
  return tree;
}

// Renvoie un message d'erreur, ou null si le code est valide
export function validateCustomBind(code: string): string | null {
  try {
    parseCustomBind(code);
    return null;
  } catch (error) {
    return error instanceof CustomBindError ? error.message : 'Code invalide';
  }
}

export async function evaluateCustomBind(node: CustomBindNode, ctx: CustomBindContext): Promise<boolean> {
  switch (node.t) {
    case 'and':
      return (await evaluateCustomBind(node.l, ctx)) && (await evaluateCustomBind(node.r, ctx));
    case 'or':
      return (await evaluateCustomBind(node.l, ctx)) || (await evaluateCustomBind(node.r, ctx));
    case 'not':
      return !(await evaluateCustomBind(node.e, ctx));
    case 'call': {
      const [a, b] = node.args;
      switch (node.name) {
        case 'ingroup': return ctx.inGroup(a);
        case 'hasrank': return (await ctx.rank(a)) === Number(b);
        case 'rankatleast':
        case 'hasrankatleast': return (await ctx.rank(a)) >= Number(b);
        case 'rankatmost':
        case 'hasrankatmost': return (await ctx.rank(a)) <= Number(b);
        case 'hasasset': return ctx.hasItem('Asset', a);
        case 'hasbadge': return ctx.hasItem('Badge', a);
        case 'hasgamepass': return ctx.hasItem('GamePass', a);
      }
      return false;
    }
  }
}
