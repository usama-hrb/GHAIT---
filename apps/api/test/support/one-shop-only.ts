import { beforeEach } from 'vitest';

/**
 * Setup file of `vitest.adopted.config.ts` only (the API suite on a multi-shop server with the live
 * shop adopted, ADR 0029 Step 4). The spec files are not changed. A test named here asserts what
 * only a one-shop server does, so it cannot pass on a multi-shop one: it is skipped, and the report
 * says it was skipped and why. Each behaviour is proved the other way round too: by the same test
 * in the ordinary run (`pnpm test:e2e`), and for the multi-shop shape by test/shop-adopt.e2e-spec.ts.
 */
const ONE_SHOP_ONLY: Record<string, string> = {
  'one shop (MULTI_SHOP off): the server is what it always was serves whatever address a request comes to, with no shop id and no shop claim':
    'a one-shop server serves any address and its tokens have no shop claim',
  'one shop (MULTI_SHOP off): the server is what it always was answers the sign-up status as before':
    'a one-shop server answers the status without `shopId`',
  'owner sign-up on a fresh server is open while the server has no owner, and needs no sign-in to ask':
    'toEqual({ open }): the sign-up status carries `shopId` on a multi-shop server (Step 2)',
  'owner sign-up on a fresh server closes once the owner exists: the status says so and a second sign-up is refused':
    'toEqual({ open }): the sign-up status carries `shopId` on a multi-shop server (Step 2)',
  'the operator turned the sign-up off reports closed and refuses, although no owner exists':
    'toEqual({ open }): the sign-up status carries `shopId` on a multi-shop server (Step 2)',
  'a server set up with `make owner` never opens the sign-up, and its owner signs in as before':
    'toEqual({ open }): the sign-up status carries `shopId` on a multi-shop server (Step 2)',
  'a server set up with `make owner` limits sign-up attempts by AUTH_REGISTER_RATE_LIMIT, on a counter of its own':
    'counts the sign-up attempt that the test above it makes after its status assertion',
};

beforeEach(({ task, skip }) => {
  // The describe names and the test's own, joined by spaces: how `-t` and this table write them.
  const why = ONE_SHOP_ONLY[task.fullTestName.replaceAll(' > ', ' ')];
  if (why !== undefined) skip(why);
});
