import { loadDotEnv } from '../env/load-env.js';

await loadDotEnv();

const [{ createApp }, { getConfig }, { assertSchemaReady }] = await Promise.all([
  import('./app.js'),
  import('./config.js'),
  import('./db/readiness.js'),
]);

await assertSchemaReady('memsense-server');

const config = getConfig();
const app = createApp();

app.listen(config.port, () => {
  console.log(`[memsense-server] listening on :${config.port}`);
});
