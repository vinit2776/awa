import { eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { roles as rolesTable, userRoles as userRolesTable } from "@/db/schema";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";
import { stagesForRoles } from "@/lib/roleStages";
import { HelpClient } from "./HelpClient";

/**
 * "How AWA works" — a browsable home for src/lib/glossary.ts, previously
 * reachable only by hovering an inline <Term>. Deep-links with
 * ?term=goods-receipt so every <Term> popover (see src/components/ui/help.tsx)
 * can point here for someone who wants to read all of it, not just this one
 * definition.
 */
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const { term } = await searchParams;
  const initialTerm: GlossaryKey | null = term && term in GLOSSARY ? (term as GlossaryKey) : null;

  const { user, tenant } = await getCurrentUserAndTenant();
  const myRoles = await withTenant(tenant.id, (tx) =>
    tx
      .select({ key: rolesTable.key })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(rolesTable.id, userRolesTable.roleId))
      .where(eq(userRolesTable.userId, user.id)),
  );

  return <HelpClient initialTerm={initialTerm} ownedStages={stagesForRoles(myRoles.map((r) => r.key))} />;
}
