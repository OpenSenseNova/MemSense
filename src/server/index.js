import { createApp } from './app.js';

const port = Number(process.env.MEMSENSE_PORT || 8787);
const app = createApp();

app.listen(port, () => {
  console.log(`[memsense-server] listening on :${port}`);
});
