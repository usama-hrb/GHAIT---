import { useSession } from '@/local-db';

/**
 * Whether this person may change the people and their money: only the owner (SPEC §11). The
 * partner reads everything and changes nothing; the server refuses their writes either way.
 */
export function useCanManage(): boolean {
  return useSession().user?.role === 'owner';
}
