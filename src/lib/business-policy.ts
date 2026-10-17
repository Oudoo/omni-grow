const id = '[1-9]\\d*';
const rules: [RegExp, string[]][] = [
  [/^context$/, ['GET']], [/^branding$/, ['PATCH']], [/^logo$/, ['GET']],
  [/^members$/, ['GET']], [new RegExp(`^members/${id}$`), ['PATCH', 'DELETE']],
  [/^invitations$/, ['POST']], [new RegExp(`^invitations/${id}$`), ['DELETE']], [/^audit$/, ['GET']],
  [/^rooms$/, ['GET', 'POST']], [new RegExp(`^rooms/${id}$`), ['GET', 'PATCH']],
  [new RegExp(`^rooms/${id}/messages$`), ['GET', 'POST']],
  [new RegExp(`^rooms/${id}/messages/${id}$`), ['PATCH', 'DELETE']],
  [new RegExp(`^rooms/${id}/read$`), ['POST']],
  [/^documents$/, ['GET', 'POST']], [new RegExp(`^documents/${id}/content$`), ['GET']],
  [new RegExp(`^documents/${id}$`), ['DELETE']],
  [new RegExp(`^rooms/${id}/meetings$`), ['POST']],
  [new RegExp(`^rooms/${id}/meetings/${id}/join$`), ['POST']],
  [new RegExp(`^rooms/${id}/meetings/${id}$`), ['DELETE']]
];
export function allowedBusinessRequest(path: string, method: string) {
  return rules.some(([pattern, methods]) => pattern.test(path) && methods.includes(method));
}
export function allowedOperatorRequest(path: string, method: string) {
  return (path === 'businesses' && ['GET', 'POST'].includes(method)) ||
    (new RegExp(`^businesses/${id}$`).test(path) && method === 'PATCH') ||
    (new RegExp(`^businesses/${id}/invitations$`).test(path) && method === 'POST');
}
