import type { Metadata } from "next";
import { requireStaffUser } from "@/lib/auth/server";
import { canUseSiteAdmin, canUseUchetWork, isOwnerRole } from "@/lib/auth/roles";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getDefaultLocation } from "@/lib/uchet/queries";
import { listKassaAssortment } from "@/lib/uchet/pos-queries";
import { listRecipes, listSiteProductsForRecipes } from "@/lib/uchet/recipes";
import { RecipesView } from "@/components/uchet/recepty/RecipesView";

export const metadata: Metadata = {
  title: "Рецепты",
};

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const staff = await requireStaffUser("/uchet/recepty", canUseUchetWork);
  const location = await getDefaultLocation();
  const siteAdmin = canUseSiteAdmin(staff.role);
  const owner = isOwnerRole(staff.role);

  const [recipes, assortment, products, costs] = await Promise.all([
    listRecipes(true),
    listKassaAssortment(location.id, location.isTraining),
    siteAdmin ? listSiteProductsForRecipes() : Promise.resolve([]),
    // Себестоимость — только владельцам: остальным сервер её просто не отдаёт.
    owner
      ? getSupabaseAdmin().from("inv_items").select("id, avg_cost").gt("avg_cost", 0).limit(3000).then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);

  return (
    <RecipesView
      recipes={recipes}
      items={assortment.items}
      products={products}
      costs={Object.fromEntries(costs.map((c) => [c.id as string, Number(c.avg_cost)]))}
      canSite={siteAdmin}
      isOwner={owner}
      isTraining={location.isTraining}
    />
  );
}
