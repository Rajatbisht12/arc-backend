import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const SECRET_ID = "arc/prod/backend";

/**
 * In production, pull all key/value pairs from AWS Secrets Manager and
 * inject them into process.env before the rest of the app initialises.
 * Already-set environment variables are never overwritten (ECS task-definition
 * overrides take precedence).
 */
export const loadSecretsManagerEnv = async (): Promise<void> => {
  if (process.env.NODE_ENV !== "production") return;

  const region = process.env.AWS_REGION || "us-east-1";

  try {
    const client = new SecretsManagerClient({ region });
    const command = new GetSecretValueCommand({ SecretId: SECRET_ID });
    const response = await client.send(command);

    if (!response.SecretString) return;

    const secrets: Record<string, string> = JSON.parse(response.SecretString);
    let injected = 0;
    for (const [key, value] of Object.entries(secrets)) {
      if (!process.env[key]) {
        process.env[key] = String(value);
        injected++;
      }
    }
    console.log(`[secrets] Loaded ${injected} vars from Secrets Manager (${SECRET_ID})`);
  } catch (err) {
    console.error("[secrets] Failed to load from Secrets Manager:", (err as Error).message);
    // Don't crash — let the app fail naturally on any missing required var
  }
};
