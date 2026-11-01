// Imposter category drift test: every category in content.json must be in
// CATEGORY_CHOICES, and every choice (except 'random') must have content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('..', import.meta.url));

test('Imposter: category choices match content', async () => {
  const content = JSON.parse(readFileSync(join(dir, 'games/imposter/content.json'), 'utf-8'));
  const engine = await import('../games/imposter/engine.js');

  const contentCategories = Object.keys(content.categories);
  const choiceValues = engine.CATEGORY_CHOICES?.map(([value]) => value)
    ?? engine.meta.options.find(o => o.key === 'category').choices.map(c => c.value);

  const nonRandomChoices = choiceValues.filter(v => v !== 'random');

  for (const cat of contentCategories) {
    assert.ok(nonRandomChoices.includes(cat), `content category "${cat}" missing from category choices`);
  }

  for (const choice of nonRandomChoices) {
    assert.ok(contentCategories.includes(choice), `choice "${choice}" has no content category`);
  }
});
