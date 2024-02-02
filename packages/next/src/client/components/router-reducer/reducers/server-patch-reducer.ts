import { createHrefFromUrl } from '../create-href-from-url'
import { applyRouterStatePatchToTreeSkipDefault } from '../apply-router-state-patch-to-tree'
import { isNavigatingToNewRootLayout } from '../is-navigating-to-new-root-layout'
import type {
  ServerPatchAction,
  ReducerState,
  ReadonlyReducerState,
  Mutable,
} from '../router-reducer-types'
import { handleExternalUrl } from './navigate-reducer'
import { applyFlightData } from '../apply-flight-data'
import { handleMutable } from '../handle-mutable'
import type { CacheNode } from '../../../../shared/lib/app-router-context.shared-runtime'
import { createEmptyCacheNode } from '../../app-router'
import { handleSegmentMismatch } from '../handle-segment-mismatch'
import { createPrefetchCacheKey } from './prefetch-cache-utils'

export function serverPatchReducer(
  state: ReadonlyReducerState,
  action: ServerPatchAction
): ReducerState {
  const { serverResponse, url } = action
  const [flightData, overrideCanonicalUrl, , intercept] = serverResponse

  const mutable: Mutable = {}

  mutable.preserveCustomHistoryState = false

  // Handle case when navigating to page in `pages` from `app`
  if (typeof flightData === 'string') {
    return handleExternalUrl(
      state,
      mutable,
      flightData,
      state.pushRef.pendingPush
    )
  }

  let currentTree = state.tree
  let currentCache = state.cache

  for (const flightDataPath of flightData) {
    // Slices off the last segment (which is at -4) as it doesn't exist in the tree yet
    const flightSegmentPath = flightDataPath.slice(0, -4)

    const [treePatch] = flightDataPath.slice(-3, -2)
    const newTree = applyRouterStatePatchToTreeSkipDefault(
      // TODO-APP: remove ''
      ['', ...flightSegmentPath],
      currentTree,
      treePatch
    )

    if (newTree === null) {
      return handleSegmentMismatch(state, action, treePatch)
    }

    if (isNavigatingToNewRootLayout(currentTree, newTree)) {
      return handleExternalUrl(
        state,
        mutable,
        state.canonicalUrl,
        state.pushRef.pendingPush
      )
    }

    const canonicalUrlOverrideHref = overrideCanonicalUrl
      ? createHrefFromUrl(overrideCanonicalUrl)
      : undefined

    if (canonicalUrlOverrideHref) {
      mutable.canonicalUrl = canonicalUrlOverrideHref
    }

    const cache: CacheNode = createEmptyCacheNode()
    applyFlightData(currentCache, cache, flightDataPath)

    mutable.patchedTree = newTree
    mutable.cache = cache

    currentCache = cache
    currentTree = newTree
  }

  const prefetchCacheKey = createPrefetchCacheKey(
    url,
    // routes that could be intercepted / are interception routes get prefixed with the nextUrl
    intercept ? state.nextUrl : undefined
  )
  const prefetchValues = state.prefetchCache.get(prefetchCacheKey)

  // If we applied a patch from the server, we want to renew the prefetch cache entry
  // Otherwise it'll remain stale and we'll keep refetching the page data
  if (prefetchValues) {
    prefetchValues.lastUsedTime = Date.now()
  }

  return handleMutable(state, mutable)
}
