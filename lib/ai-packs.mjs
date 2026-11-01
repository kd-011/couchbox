// The AI pack maker: type a theme, get a themed content pack for one game
// through OpenRouter, built for a DB-less app: a hard daily spend cap
// tracked in one small JSON file instead of sqlite, no live model-price
// lookup (a deliberately pessimistic fallback price guards the pre-flight
// worst case; the real cost, OpenRouter's own usage.cost, trues it up after).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { findProfanity } from './profanity.mjs';
import { makeLimiter } from './ratelimit.mjs';

const API = 'https://openrouter.ai/api/v1/chat/completions';
// US$ per token. A cheap fast model costs far less than this in practice;
// it only has to be pessimistic enough that the pre-flight check can never
// let real spend slip past the cap before the response (and its real cost)
// comes back.
const FALLBACK_PRICE = { prompt: 2e-7, completion: 8e-7 };
const GEN_WINDOW_MS = 60 * 60_000;
const GEN_LIMIT_PER_IP = 8;
const AI_ITEM_COUNT = 24; // themed packs stay short: fast, cheap, plenty for a night
const MAX_TOKENS = 3000;
const THEME_MAX = 120;

function localDay(at) {
  return new Date(at).toISOString().slice(0, 10);
}

function jsonSchemaFor(schema, count) {
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      items: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: {
          type: 'object',
          properties: Object.fromEntries(schema.fields.map((f) => [f.key, { type: 'string' }])),
          required: schema.fields.map((f) => f.key),
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'items'],
    additionalProperties: false,
  };
}

function prompt(schema, theme, count) {
  const fieldList = schema.fields.map((f) => `"${f.key}" (${f.label}${f.maxLength ? `, max ${f.maxLength} characters` : ''})`).join(', ');
  const system = `You invent content packs for a party game app. ${schema.aiHint} Output exactly ${count} ${schema.itemLabel}s as JSON. Each item is an object with fields: ${fieldList}. Make them playable, varied, and in good fun; never hateful, sexual, or targeting a real identifiable private person. Also invent a short pack title (a few words).`;
  const user = `Theme: ${theme}`;
  return { system, user };
}

export function makeAiPackMaker({ spendFile, apiKey, model, dailyCapUsd, referer = '', games, packs, fetchImpl = fetch, log = () => {}, now = () => Date.now() }) {
  mkdirSync(dirname(spendFile), { recursive: true });
  const limiter = makeLimiter(GEN_WINDOW_MS);

  function readSpend() {
    const day = localDay(now());
    if (!existsSync(spendFile)) return { day, usd: 0, calls: 0 };
    try {
      const d = JSON.parse(readFileSync(spendFile, 'utf8'));
      return d.day === day ? d : { day, usd: 0, calls: 0 };
    } catch { return { day, usd: 0, calls: 0 }; }
  }
  function writeSpend(d) { writeFileSync(spendFile, JSON.stringify(d)); }
  function record(usd, calls = 0) {
    const d = readSpend();
    d.usd = Math.max(0, d.usd + usd);
    d.calls += calls;
    writeSpend(d);
    return d;
  }

  function status() {
    const d = readSpend();
    return { day: d.day, usd: d.usd, cap: dailyCapUsd, calls: d.calls, enabled: !!apiKey };
  }

  async function generate({ ip, gameId, theme }) {
    const game = games.get(gameId);
    if (!game || !game.engine.pack) return { error: 'bad', message: 'That game does not take packs.' };
    const schema = game.engine.pack;
    const clean = String(theme || '').trim().replace(/\s+/g, ' ').slice(0, THEME_MAX);
    if (!clean) return { error: 'bad', message: 'Type a theme first.' };
    if (findProfanity([clean])) return { error: 'bad', message: "That theme has something in it we can't use. Try different wording." };
    if (!apiKey) return { error: 'unavailable', message: 'AI packs are taking a break today. Try building one yourself instead.' };
    if (ip && !limiter.hit(ip, GEN_LIMIT_PER_IP)) {
      return { error: 'unavailable', message: 'Too many AI packs from this connection in the last hour. Try again later, or build one yourself.' };
    }
    const spend = readSpend();
    const count = Math.max(schema.minItems, Math.min(AI_ITEM_COUNT, schema.maxItems));
    const { system, user } = prompt(schema, clean, count);
    const worst = (system.length + user.length) * FALLBACK_PRICE.prompt + MAX_TOKENS * FALLBACK_PRICE.completion;
    if (spend.usd + worst > dailyCapUsd) {
      return { error: 'unavailable', message: 'AI packs are taking a break today. Try again tomorrow, or build one yourself.' };
    }
    record(worst, 0);
    let res;
    try {
      res = await fetchImpl(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(referer ? { 'HTTP-Referer': referer } : {}), 'X-Title': 'Games pack maker' },
        body: JSON.stringify({
          model,
          temperature: 0.9,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_schema', json_schema: { name: 'pack', strict: true, schema: jsonSchemaFor(schema, count) } },
          usage: { include: true },
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      record(-worst, 0);
      log(`request failed: ${err.message}`);
      return { error: 'unavailable', message: 'The AI pack maker is not responding right now. Try again shortly, or build one yourself.' };
    }
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) record(-worst, 0);
      log(`openrouter ${res.status}`);
      return { error: 'unavailable', message: 'The AI pack maker is not responding right now. Try again shortly, or build one yourself.' };
    }
    const data = await res.json();
    const u = data?.usage || {};
    const cost = Number.isFinite(Number(u.cost)) ? Number(u.cost) : (u.prompt_tokens || 0) * FALLBACK_PRICE.prompt + (u.completion_tokens || 0) * FALLBACK_PRICE.completion;
    record(cost - worst, 1);
    const text = data?.choices?.[0]?.message?.content || '';
    let json;
    try { json = JSON.parse(String(text).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')); } catch {
      return { error: 'unavailable', message: "The AI pack maker's answer did not come back right. Try again, or build one yourself." };
    }
    const built = packs.create({ ip, gameId, title: json.title, items: json.items, source: 'ai' });
    if (built.error) return { error: 'bad', message: built.error };
    log(`generated pack ${built.pack.code} for ${gameId} ("${clean}"), US$${cost.toFixed(5)}`);
    return { pack: built.pack };
  }

  return { generate, status };
}
