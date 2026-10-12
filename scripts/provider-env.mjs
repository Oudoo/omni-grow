import { readFile, writeFile } from 'node:fs/promises';

// Copy optional securely injected runtime values into private Compose files.
// Never replace an operator's configured value or print credentials.
const engineNames = [
  'FB_APP_ID', 'FB_APP_SECRET', 'FB_VERIFY_TOKEN', 'FACEBOOK_API_VERSION',
  'INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN',
  'WHATSAPP_APP_ID', 'WHATSAPP_APP_SECRET',
  'MAILER_SENDER_EMAIL', 'SMTP_DOMAIN', 'SMTP_ADDRESS', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_AUTHENTICATION', 'SMTP_ENABLE_STARTTLS_AUTO', 'SMTP_OPENSSL_VERIFY_MODE',
  'SENTRY_DSN', 'RACK_ATTACK_ALLOWED_IPS'
];
// Hardening defaults appended to engine configuration when absent. Operators may override any of them.
export const engineDefaults = [
  ['DISABLE_TELEMETRY', 'true'],          // No instance metrics to the vendor hub; version checks still work.
  ['MAXIMUM_FILE_UPLOAD_SIZE', '20'],      // Matches the 20 MB limit enforced by Caddy and the app.
  ['LOGRAGE_ENABLED', 'true']             // Structured request logs with request ids for correlation.
];
export async function appendMissing(path, entries, composeFile = false) {
  let content = await readFile(path, 'utf8');
  let changed = false;
  for (const [name, value] of entries) {
    if (!value) continue;
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*(.*)$`, 'gm');
    const assignments = [...content.matchAll(pattern)];
    // Respect every valid existing assignment, including export and whitespace.
    if (assignments.some(match => !/^(?:""|'')?[ \t]*(?:#.*)?$/.test(match[1]))) continue;
    if (/[\r\n]/.test(value)) throw new Error(`Injected ${name} must be a single-line value.`);
    // Compose and Next's dotenv-expand use different literal-dollar escapes.
    const encoded = JSON.stringify(value).replaceAll('$', () => composeFile ? '$$' : '\\$');
    const line = `${name}=${encoded}`;
    const current = assignments.at(-1);
    content = current
      ? content.slice(0, current.index) + line + content.slice(current.index + current[0].length)
      : content.replace(/\n?$/, '\n') + line + '\n';
    changed = true;
  }
  if (changed) await writeFile(path, content, { mode: 0o600 });
}
export async function configureProviders() {
  const appEntries = [
    ['NEXT_PUBLIC_FB_APP_ID', process.env.NEXT_PUBLIC_FB_APP_ID || process.env.FB_APP_ID],
    ['NEXT_PUBLIC_FB_API_VERSION', process.env.NEXT_PUBLIC_FB_API_VERSION || process.env.FACEBOOK_API_VERSION],
    ['INSTAGRAM_APP_ID', process.env.INSTAGRAM_APP_ID]
  ];
  // App settings contain public numeric IDs and API versions, never provider secrets.
  for (const [name, value] of appEntries) {
    const valid = name === 'NEXT_PUBLIC_FB_API_VERSION' ? /^v\d+\.\d+$/ : /^\d+$/;
    if (value && !valid.test(value)) throw new Error(`Injected ${name} must be ${name === 'NEXT_PUBLIC_FB_API_VERSION' ? 'an API version such as v26.0' : 'a numeric application ID'}.`);
  }
  await appendMissing('.local/engine.env', engineNames.map(name => [name, process.env[name]]), true);
  await appendMissing('.local/engine.env', engineDefaults, true);
  await appendMissing('.env.local', appEntries);
}
