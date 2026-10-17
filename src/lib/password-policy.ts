// Mirrors the messaging engine's password policy (Devise secure_password as configured by
// Chatwoot 4.18.0): 6 to 128 characters with at least one uppercase letter, one lowercase
// letter, one number and one symbol from a fixed ASCII set; every other character is rejected.
// OmniGrow asks invited employees for at least 12 characters. The engine stays the authority;
// this only explains the rule before the request is sent.
export const PASSWORD_SYMBOLS = ' !@#$%^&*()_+-=[]{}|"/\\.,`<>:;?~\'';
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_POLICY_HINT = `Use ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters with at least one uppercase letter, one lowercase letter, one number and one symbol such as ! @ # $ % &. Only Latin letters, numbers and standard keyboard symbols are accepted.`;
export function passwordPolicyProblem(password: string): string | undefined {
  const characters = [...password];
  if (characters.length < PASSWORD_MIN_LENGTH || characters.length > PASSWORD_MAX_LENGTH) return `Use ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;
  if (!/[A-Z]/.test(password)) return 'Include at least one uppercase letter (A to Z).';
  if (!/[a-z]/.test(password)) return 'Include at least one lowercase letter (a to z).';
  if (!/[0-9]/.test(password)) return 'Include at least one number.';
  if (!characters.some(character => PASSWORD_SYMBOLS.includes(character))) return 'Include at least one symbol such as ! @ # $ % &.';
  if (characters.some(character => !/^[A-Za-z0-9]$/.test(character) && !PASSWORD_SYMBOLS.includes(character))) return 'Use only Latin letters, numbers and standard keyboard symbols.';
  return undefined;
}
