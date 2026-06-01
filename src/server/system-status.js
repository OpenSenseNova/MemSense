export function buildSetupStatus(env = process.env) {
  const provider = env.MEMSENSE_EMBEDDING_PROVIDER || 'openai';
  const checks = [];

  if (provider === 'openai') {
    checks.push({
      key: 'MEMSENSE_OPENAI_API_KEY',
      ok: Boolean(env.MEMSENSE_OPENAI_API_KEY),
      message: env.MEMSENSE_OPENAI_API_KEY ? 'configured' : 'missing',
    });
    checks.push({
      key: 'MEMSENSE_OPENAI_BASE_URL',
      ok: Boolean(env.MEMSENSE_OPENAI_BASE_URL),
      message: env.MEMSENSE_OPENAI_BASE_URL ? 'configured' : 'using default',
    });
  } else if (provider === 'bge_http') {
    checks.push({
      key: 'MEMSENSE_BGE_ENDPOINT',
      ok: Boolean(env.MEMSENSE_BGE_ENDPOINT),
      message: env.MEMSENSE_BGE_ENDPOINT ? 'configured' : 'missing',
    });
  }

  const ok = checks.every((c) => c.ok || c.message === 'using default');

  return {
    ok,
    provider,
    checks,
    next_steps: [
      'macOS/Linux/WSL/Git Bash interactive setup: bash scripts/bootstrap.sh',
      'macOS/Linux/WSL/Git Bash OpenAI mode: bash scripts/bootstrap.sh openai',
      'macOS/Linux/WSL/Git Bash Local BGE mode: bash scripts/bootstrap.sh local',
      'Windows PowerShell interactive setup: .\\scripts\\bootstrap.ps1',
      'Windows PowerShell OpenAI mode: .\\scripts\\bootstrap.ps1 openai',
      'Windows PowerShell Local BGE mode: .\\scripts\\bootstrap.ps1 local',
    ],
  };
}
