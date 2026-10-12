// A fixed account comes from the sealed session, never a browser-supplied path.
// Chatwoot independently enforces account membership and inbox authorization.
const rules: [RegExp, string[]][] = [
  [/^conversations$/, ['GET']],
  [/^conversations\/search$/, ['GET']],
  [/^conversations\/[1-9]\d*$/, ['GET', 'PATCH']],
  [/^conversations\/[1-9]\d*\/messages$/, ['GET', 'POST']],
  [/^conversations\/[1-9]\d*\/messages\/[1-9]\d*\/retry$/, ['POST']],
  [/^conversations\/[1-9]\d*\/(toggle_status|toggle_priority|assignments|labels|toggle_typing_status|update_last_seen)$/, ['POST']],
  [/^inboxes$/, ['GET', 'POST']],
  [/^channels\/twilio_channel$/, ['POST']],
  [/^inboxes\/[1-9]\d*$/, ['GET', 'PATCH']],
  [/^inboxes\/[1-9]\d*\/set_agent_bot$/, ['POST']],
  [/^inboxes\/[1-9]\d*\/agent_bot$/, ['GET']],
  [/^inbox_members\/[1-9]\d*$/, ['GET']],
  [/^inbox_members$/, ['POST', 'PATCH']],
  [/^agents$/, ['GET', 'POST']],
  [/^agents\/[1-9]\d*$/, ['PATCH', 'DELETE']],
  [/^contacts$/, ['GET', 'POST']],
  [/^contacts\/search$/, ['GET']],
  [/^contacts\/[1-9]\d*$/, ['GET', 'PUT']],
  [/^contacts\/[1-9]\d*\/conversations$/, ['GET']],
  [/^(canned_responses|automation_rules|webhooks|agent_bots)$/, ['GET', 'POST']],
  [/^(canned_responses|automation_rules|webhooks|agent_bots)\/[1-9]\d*$/, ['PATCH', 'DELETE']],
  [/^labels$/, ['GET', 'POST']],
  [/^teams$/, ['GET']],
  [/^reports\/summary$/, ['GET']],
  [/^reports$/, ['GET']]
];
export function allowedWorkspaceRequest(path: string, method: string) {
  return rules.some(([rule, methods]) => rule.test(path) && methods.includes(method));
}
export function sameOrigin(origin: string | null, appUrl: string) {
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(appUrl).origin; } catch { return false; }
}
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) =>
      key === 'website_token' || !/(password|token|api[_-]?key|hmac|provider_config|secret)/i.test(key)
    ).map(([key, v]) => [key, redactSecrets(v)]));
  }
  return value;
}
export function safeExternalUrl(value: string | undefined) {
  if (!value) return undefined;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
