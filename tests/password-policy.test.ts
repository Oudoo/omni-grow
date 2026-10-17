import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordPolicyProblem } from '../src/lib/password-policy';

test('the invitation form mirrors the engine password policy', () => {
  assert.equal(passwordPolicyProblem('Correct-Horse-7!'), undefined);
  assert.equal(passwordPolicyProblem("Quote's fine 1A"), undefined);
  assert.match(passwordPolicyProblem('Short1!')!, /12 to 128/);
  assert.match(passwordPolicyProblem(`${'a'.repeat(126)}A1!`)!, /12 to 128/);
  assert.match(passwordPolicyProblem('weakpassword1234')!, /uppercase/);
  assert.match(passwordPolicyProblem('WEAKPASSWORD1234')!, /lowercase/);
  assert.match(passwordPolicyProblem('WeakPassword!!!!')!, /number/);
  assert.match(passwordPolicyProblem('WeakPassword1234')!, /symbol/);
  assert.match(passwordPolicyProblem('Wéak-Password-1!')!, /Latin letters/);
});
