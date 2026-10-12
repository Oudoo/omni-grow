import { NextRequest } from 'next/server';
import { log, readLimitedBytes, requestReference } from '@/lib/server';

// Browsers post Content Security Policy violation reports here (see src/lib/csp.ts). Reports are
// logged so an operator can see what a stricter policy would block before switching CSP_MODE to
// enforce. Nothing is stored and the endpoint always answers 204.
const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.slice(0, max) : undefined);
export async function POST(request: NextRequest) {
  try {
    const body = JSON.parse(new TextDecoder().decode(await readLimitedBytes(request, 20_000)));
    const report = (body && typeof body === 'object' && 'csp-report' in body ? body['csp-report'] : body) as Record<string, unknown>;
    if (report && typeof report === 'object') {
      log('warn', 'content security policy violation', {
        reference: requestReference(request), documentUri: text(report['document-uri']), violatedDirective: text(report['violated-directive'] ?? report['effective-directive']),
        blockedUri: text(report['blocked-uri']), sourceFile: text(report['source-file']), line: typeof report['line-number'] === 'number' ? report['line-number'] : undefined
      });
    }
  } catch { /* Malformed or oversized reports are ignored. */ }
  return new Response(null, { status: 204 });
}
