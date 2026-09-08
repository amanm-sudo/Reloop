import { clearSessionCookie } from '@/lib/auth';
import { guarded, ok, toResponse, type Result } from '@/lib/result';

export async function POST(): Promise<Response> {
  const result = await guarded('auth/logout', async (): Promise<Result<{ signedOut: true }>> => {
    await clearSessionCookie();
    return ok({ signedOut: true });
  });

  return toResponse(result);
}
