import type { ConnectionRole } from '../connection/role-store';

/** The two role audiences a feed can be filtered by. */
export type FeedAudience = 'masculine' | 'feminine';

/**
 * The audience to request from the feed given the viewer's role and whether the
 * "For me" filter is on. Returns `undefined` (no filter — show everything) when
 * the filter is off, or when the viewer has no concrete role (neutral / unpaired):
 * a neutral viewer has no role lane to narrow to. When on with a masculine /
 * feminine role, the server returns that role's posts plus `everyone`.
 */
export function effectiveAudience(
  myRole: ConnectionRole | null,
  filterOn: boolean,
): FeedAudience | undefined {
  if (!filterOn) return undefined;
  if (myRole === 'masculine' || myRole === 'feminine') return myRole;
  return undefined;
}
