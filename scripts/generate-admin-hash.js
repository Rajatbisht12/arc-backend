/**
 * Generates a bcrypt hash for your admin password.
 *
 * Usage:
 *   node scripts/generate-admin-hash.js <your-password>
 *
 * Copy the output and set it as ADMIN_PASSWORD_HASH in your .env / AWS ECS task definition.
 */

const bcrypt = require("bcryptjs");

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/generate-admin-hash.js <your-password>");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Error: Password must be at least 8 characters long.");
  process.exit(1);
}

(async () => {
  const hash = await bcrypt.hash(password, 12);
  console.log("\n✅ Admin password hash generated successfully!\n");
  console.log("Add this to your .env or AWS ECS environment variables:");
  console.log("─────────────────────────────────────────────────────");
  console.log(`ADMIN_PASSWORD_HASH=${hash}`);
  console.log("─────────────────────────────────────────────────────");
  console.log("\n⚠️  Keep this hash secret. Do NOT commit it to git.\n");
})();
