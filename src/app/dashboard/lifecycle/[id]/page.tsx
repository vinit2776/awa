import { permanentRedirect } from "next/navigation";

/**
 * The tracker used to live here, on a page of its own, reached through a
 * nav item called "Lifecycle". That was the wrong shape: where a
 * requisition has got to is not a separate thing to go and look up, it
 * is the first thing its own record should say. The content moved to
 * /dashboard/requisitions/[id] — which had no page at all until then,
 * despite the Queries inbox already linking to it.
 *
 * Kept as a redirect rather than deleted: the ids are the same, and
 * "Track" buttons, notification links and bookmarks in the wild point
 * here. /dashboard/lifecycle (the list) is untouched — a cross-cutting
 * "where is everything" view is a real page; a per-record one wasn't.
 */
export default async function LifecycleDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  permanentRedirect(`/dashboard/requisitions/${id}`);
}
