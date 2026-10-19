import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { assertRuntimeIsolation, isIsolationControl, RuntimeIsolationError, runtimeSecretTarget } from './runtimeIsolation';
import { VIDEO_COMPATIBILITY_FLAGS } from '../legacy-src/config/videoDeploymentPolicy';

/**
 * In production, pull all key/value pairs from AWS Secrets Manager and
 * inject them into process.env before the rest of the app initialises.
 * Already-set environment variables are never overwritten (ECS task-definition
 * overrides take precedence).
 */
export const loadSecretsManagerEnv = async (): Promise<void> => {
  const target = runtimeSecretTarget(process.env);
  if (!target.load) { assertRuntimeIsolation(process.env); return; }
  // These must be chosen by the task definition, never by a secret response.
  const bootstrapControls = Object.fromEntries(Object.entries(process.env).filter(([name]) => isIsolationControl(name)));

  const region = process.env.AWS_REGION || "us-east-1";

  try {
    const client = new SecretsManagerClient({ region });
    const command = new GetSecretValueCommand({ SecretId: target.secretId });
    const response = await client.send(command);

    if (!response.SecretString) throw new Error('Runtime secret has no JSON SecretString');

    const secrets: Record<string, string> = JSON.parse(response.SecretString);
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) throw new Error('Runtime secret must be a JSON object');
    if (process.env.VIDEO_DEPLOYMENT_MODE === 'compatibility') {
      for (const [name, value] of Object.entries(VIDEO_COMPATIBILITY_FLAGS)) {
        if (secrets[name] !== undefined && String(secrets[name]) !== value) {
          throw new RuntimeIsolationError(`Compatibility release conflicts with shared runtime ${name}; review the active topology first`);
        }
      }
    }
    let injected = 0;
    for (const [key, value] of Object.entries(secrets)) {
      if (isIsolationControl(key)) {
        if (String(value) !== bootstrapControls[key]) throw new RuntimeIsolationError(`Runtime secret may not override bootstrap control ${key}`);
        continue;
      }
      if (!process.env[key]) {
        process.env[key] = String(value);
        injected++;
      }
    }
    assertRuntimeIsolation(process.env);
    console.log(`[secrets] Loaded ${injected} vars from Secrets Manager (${target.secretId})`);
  } catch (err) {
    console.error("[secrets] Failed to load from Secrets Manager:", (err as Error).message);
    if (target.deployment === 'staging' || err instanceof RuntimeIsolationError) throw new Error('Runtime secret loading/isolation failed; startup refused');
    // Preserve the established production task-env fallback.
  }
};
