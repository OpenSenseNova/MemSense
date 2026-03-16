export function buildChunk({
  tenantId,
  scope,
  sessionId,
  userId,
  userText,
  assistantText,
  tags = [],
  taskTag,
  source = 'session',
  timestamp = Date.now(),
  score = 0.5,
}) {
  const content = JSON.stringify({ user: String(userText || ''), assistant: String(assistantText || '') });
  return {
    tenantId,
    scope,
    sessionId,
    userId,
    content,
    tags,
    taskTag,
    source,
    timestamp,
    score,
    typeHint: 'qa_chunk',
  };
}
