import { permanentRedirect } from "next/navigation";

/**
 * This was a second requisition list, differing from /dashboard/requisitions
 * only in that it skipped the requestorId filter. Two nav entries for one
 * table taught every new user that there were two kinds of requisition.
 * Whose requisitions you want to see is a filter, so it is a filter now.
 *
 * The route survives as a redirect because "Lifecycle" has been in the
 * sidebar for the whole project and will be in people's history and
 * bookmarks.
 */
export default function LifecycleListRedirect() {
  permanentRedirect("/dashboard/requisitions?scope=all");
}
