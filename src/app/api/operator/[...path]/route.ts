import { NextRequest } from 'next/server';
import { ApiError, fail, requireSession } from '@/lib/server';
import { allowedOperatorRequest } from '@/lib/business-policy';
import { businessProxy } from '@/lib/business-server';
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const state = await requireSession();
    const path = (await context.params).path.join('/');
    if (!allowedOperatorRequest(path, request.method)) throw new ApiError(404, 'This operator action is unavailable.');
    // The engine checks the current database SuperAdmin identity on every call.
    return await businessProxy(request, `/api/v1/omnigrow/${path}${request.nextUrl.search}`, state.auth);
  } catch (error) { return fail(error, request); }
}
export { handle as GET, handle as POST, handle as PATCH };
