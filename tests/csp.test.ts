import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContentSecurityPolicy, cspHeaderName, cspMode } from '../src/lib/csp';

test('report-only is the default mode and enforce must be explicit', () => {
  assert.equal(cspMode(undefined), 'report-only');
  assert.equal(cspMode('nonsense'), 'report-only');
  assert.equal(cspMode('enforce'), 'enforce');
  assert.equal(cspMode('off'), 'off');
  assert.equal(cspHeaderName('enforce'), 'Content-Security-Policy');
  assert.equal(cspHeaderName('report-only'), 'Content-Security-Policy-Report-Only');
});
test('the policy is nonce based, names the engine and Meta origins, and never allows inline scripts', () => {
  const policy = buildContentSecurityPolicy({ nonce: 'abc123', engineUrl: 'https://messages.example.com/', appUrl: 'https://og.example.com', extraImageSources: 'https://files.example.com javascript:alert(1) https://cdn.example.com' });
  const directive = (name: string) => policy.split('; ').find(part => part.startsWith(`${name} `)) || '';
  assert.match(directive('script-src'), /'nonce-abc123'/);
  assert.match(directive('script-src'), /'strict-dynamic'/);
  assert.doesNotMatch(directive('script-src'), /unsafe-inline|unsafe-eval/);
  assert.match(directive('script-src'), /https:\/\/messages\.example\.com/);
  assert.match(directive('frame-src'), /https:\/\/messages\.example\.com/);
  assert.match(directive('connect-src'), /https:\/\/messages\.example\.com/);
  assert.match(directive('img-src'), /https:\/\/files\.example\.com https:\/\/cdn\.example\.com/);
  assert.doesNotMatch(policy, /javascript:/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /report-uri \/api\/csp-report/);
  assert.match(policy, /upgrade-insecure-requests/);
});
test('development adds unsafe-eval for React debugging and plain http skips upgrade-insecure-requests', () => {
  const policy = buildContentSecurityPolicy({ nonce: 'n', engineUrl: 'http://localhost:3001', appUrl: 'http://localhost:3000', development: true });
  assert.match(policy, /'unsafe-eval'/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
  assert.match(policy, /http:\/\/localhost:3001/);
});
