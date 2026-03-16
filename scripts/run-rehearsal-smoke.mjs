import { LocalMemoryStore } from '../src/local-engine.js';
import { assert, section, summarizeResult } from './rehearsal-helpers.mjs';

const store = new LocalMemoryStore();

const tenantId = `rehearsal-${Date.now()}`;
const scope = 'task';

section('write');
const written = store.write({
  tenantId,
  scope,
  content: 'OpenClaw rehearsal memory: prefer deterministic smoke tests',
  typeHint: 'semantic',
  mode: 'write_back',
  confidence: 0.8,
});
assert(written.memoryId && written.memoryId.startsWith('mem_'), 'write should return memoryId');
console.log('written:', written.memoryId);

section('retrieve');
const retrieved = store.retrieve({ tenantId, scope, query: 'deterministic', topK: 5 });
assert(retrieved.length >= 1, 'retrieve should return at least one candidate');
assert(retrieved.some((r) => r.memoryId === written.memoryId), 'retrieve should include written memory');
console.log('retrieved:', retrieved.length);

section('feedback');
const feedbackRes = store.feedback({ memoryId: written.memoryId, label: 'accepted' });
assert(feedbackRes.ok === true, 'feedback should return ok=true');
console.log('feedback: ok');

section('audit-before-forget');
const auditBeforeForget = store.audit(written.memoryId);
assert(auditBeforeForget.some((e) => e.eventType === 'capture'), 'audit should contain capture event');
assert(auditBeforeForget.some((e) => e.eventType === 'feedback'), 'audit should contain feedback event');
console.log('audit events (before forget):', auditBeforeForget.length);

section('forget');
const forgetRes = store.forget({ memoryId: written.memoryId });
assert(forgetRes.deleted === true, 'forget should delete the written memory');
console.log('forget: deleted');

section('audit-after-forget');
const auditAfterForget = store.audit(written.memoryId);
assert(auditAfterForget.some((e) => e.eventType === 'forget'), 'audit should contain forget event');
console.log('audit events (after forget):', auditAfterForget.length);

section('degraded-path checks');
const emptyRetrieve = store.retrieve({
  tenantId: 'rehearsal-empty',
  scope: 'user',
  query: 'anything',
  topK: 3,
});
assert(Array.isArray(emptyRetrieve) && emptyRetrieve.length === 0, 'empty tenant retrieve should return []');

const unknownForget = store.forget({ memoryId: 'mem_not_exists' });
assert(unknownForget.deleted === false, 'forget unknown memory should return deleted=false');

const unknownAudit = store.audit('mem_not_exists');
assert(Array.isArray(unknownAudit) && unknownAudit.length === 0, 'audit unknown memory should return []');
console.log('degraded checks: ok');

section('summary');
console.log(
  JSON.stringify(
    summarizeResult({
      writtenId: written.memoryId,
      retrievedCount: retrieved.length,
      auditCountBeforeForget: auditBeforeForget.length,
      auditCountAfterForget: auditAfterForget.length,
    }),
    null,
    2,
  ),
);
