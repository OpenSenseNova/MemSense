export function getConfig() {
  return {
    port: Number(process.env.MEMSENSE_PORT || 8787),
    dbUrl: process.env.MEMSENSE_DATABASE_URL,
    embedding: {
      provider: process.env.MEMSENSE_EMBEDDING_PROVIDER || 'openai',
      model: process.env.MEMSENSE_EMBEDDING_MODEL || 'text-embedding-v4',
      maxChars: Number(process.env.MEMSENSE_EMBEDDING_MAX_CHARS || 4000),
      openaiBaseUrl: process.env.MEMSENSE_OPENAI_BASE_URL || 'https://api.openai.com/v1',
      openaiApiKey: process.env.MEMSENSE_OPENAI_API_KEY || '',
      bgeEndpoint: process.env.MEMSENSE_BGE_ENDPOINT || 'http://127.0.0.1:8000/embed',
      bgeModel: process.env.MEMSENSE_BGE_MODEL || 'bge-large-zh-v1.5',
    },
  };
}
