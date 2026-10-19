import 'dotenv/config';
import { loadSecretsManagerEnv } from './config/secrets';

// Load the same runtime secrets as the API before env/storage/queue imports.
loadSecretsManagerEnv().then(() => import('./clip-worker')).catch(error => {
  console.error('Video worker configuration failed:', String(error));
  process.exit(1);
});
