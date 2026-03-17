export function getDashboardContract() {
  return {
    version: '2026-03-16',
    memoryList: {
      coreFields: ['memory_id', 'content', 'status', 'timestamp_ms'],
      metaFields: ['memory_kind', 'tags', 'source', 'tenant_id', 'scope', 'user_id', 'agent_id', 'session_id', 'score', 'confidence'],
      fieldTypes: {
        memory_id: 'text',
        content: 'text',
        status: 'badge',
        timestamp_ms: 'datetime',
        memory_kind: 'badge',
        tags: 'tags',
        source: 'text',
        tenant_id: 'text',
        scope: 'text',
        user_id: 'text',
        agent_id: 'text',
        session_id: 'text',
        score: 'number',
        confidence: 'number',
      },
      labels: {
        memory_id: 'Memory ID',
        content: 'Content',
        status: 'Status',
        timestamp_ms: 'Time',
        memory_kind: 'Kind',
        tags: 'Tags',
        source: 'Source',
        tenant_id: 'Tenant',
        scope: 'Scope',
        user_id: 'User',
        agent_id: 'Agent',
        session_id: 'Session',
        score: 'Score',
        confidence: 'Confidence',
      },
    },
    pipeline: {
      sections: ['chunks', 'embedding_jobs', 'tag_jobs'],
      sectionTypes: {
        chunks: 'metrics',
        embedding_jobs: 'metrics',
        tag_jobs: 'metrics',
      },
      labels: {
        chunks: 'Chunks',
        embedding_jobs: 'Embedding Jobs',
        tag_jobs: 'Tag Jobs',
      },
    },
  };
}
