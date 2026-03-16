export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function section(name) {
  console.log(`\n== ${name} ==`);
}

export function summarizeResult({ writtenId, retrievedCount, auditCountBeforeForget, auditCountAfterForget }) {
  return {
    ok: true,
    writtenId,
    retrievedCount,
    auditCountBeforeForget,
    auditCountAfterForget,
    timestamp: new Date().toISOString(),
  };
}
