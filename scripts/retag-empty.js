import { loadDotEnv } from '../src/env/load-env.js';

await loadDotEnv();

const [
  { query },
  { generateTagsWithOpenClaw, mergeTags },
] = await Promise.all([
  import('../src/server/db/client.js'),
  import('../src/worker/tag-model.js'),
]);

async function retagEmpty() {
  const result = await query(
    `SELECT id, content FROM memory_chunks
     WHERE status = 'active'
       AND (tags IS NULL OR jsonb_array_length(tags) = 0)
     ORDER BY id ASC`
  );

  console.log(`Found ${result.rows.length} chunks without tags`);

  for (const row of result.rows) {
    try {
      console.log(`Processing chunk ${row.id}...`);
      const generated = await generateTagsWithOpenClaw(row.content);
      const taskTag = generated.tags.length > 0 ? generated.tags.join('; ') : null;

      await query(
        `UPDATE memory_chunks
         SET tags = $2::jsonb, memory_kind = $3, task_tag = $4, updated_at = NOW()
         WHERE id = $1`,
        [row.id, JSON.stringify(generated.tags), generated.memory_kind, taskTag]
      );

      console.log(`✓ Chunk ${row.id}: ${generated.tags.length} tags, kind=${generated.memory_kind}`);
    } catch (e) {
      console.error(`✗ Chunk ${row.id} failed:`, e.message);
    }
  }

  console.log('Done!');
  process.exit(0);
}

retagEmpty().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});