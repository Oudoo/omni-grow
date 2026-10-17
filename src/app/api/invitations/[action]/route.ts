import { NextRequest } from 'next/server';
import { ApiError, fail, session, identityIsActive } from '@/lib/server';
import { businessProxy } from '@/lib/business-server';
export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  try {
    const action = (await context.params).action;
    if (!['preview', 'accept'].includes(action)) throw new ApiError(404, 'This invitation action is unavailable.');
    const state = await session();
    return await businessProxy(request, `/api/v1/omnigrow/invitations/${action}`, identityIsActive(state) ? state.auth : undefined);
  } catch (error) { return fail(error, request); }
}
