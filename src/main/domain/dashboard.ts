import { desc, eq, inArray, isNotNull, isNull, gte, and } from 'drizzle-orm';
import type { DbLike } from '../db/client.js';
import {
  batches,
  components,
  products,
  productVariants,
  recipes,
  stockMovements,
} from '../db/schema.js';
import { bankersRoundToPence } from './money.js';

export interface DashboardSummary {
  components: ComponentSummary;
  variants: VariantSummary;
  batches: BatchSummary;
  stockTargets: StockTargetRow[];
  targetRevenue: TargetRevenueSummary;
  shoppingList: ShoppingListItem[];
  shoppingListTotalPence: number;
  recentMovements: RecentMovement[];
}

export interface TargetRevenueSummary {
  // If every targeted variant was at full target stock and sold:
  totalRevenuePence: number;
  totalCostPence: number;
  totalProfitPence: number;
  marginPct: number | null;
  // Just the units still needed to reach target (the "make and sell" portion):
  deficitRevenuePence: number;
  deficitProfitPence: number;
  targetedVariantCount: number;
}

export interface ShoppingListItem {
  componentId: number;
  componentName: string;
  componentColour: string | null;
  componentSize: string | null;
  componentUnit: string;
  packSize: number | null;
  link: string | null;
  // For measured units:
  totalNeededQty: number;
  currentQty: number | null;
  shortfallQty: number;
  packsNeeded: number | null;
  // For cost_pool units:
  totalNeededValuePence: number;
  currentValuePence: number | null;
  shortfallValuePence: number;
  // Estimated cost of buying exactly the shortfall (best-effort).
  estimatedCostPence: number;
  // Which variants drove this need (helpful context).
  drivenBy: { variantId: number; variantName: string; deficit: number }[];
}

export interface StockTargetRow {
  variantId: number;
  productName: string;
  variantName: string;
  sku: string;
  currentStock: number;
  targetStock: number;
  deficit: number; // max(target - current, 0)
  ratio: number; // current / target
  status: 'ok' | 'low' | 'needed';
}

interface ComponentSummary {
  activeCount: number;
  measuredCount: number;
  poolCount: number;
  totalValuePence: number;
  belowReorder: BelowReorderRow[];
  missingCost: MissingCostRow[];
  negative: NegativeStockRow[];
}

interface VariantSummary {
  activeCount: number;
  totalUnits: number;
  totalValueAtCostPence: number;
  totalValueAtRetailPence: number;
  missingRecipe: { id: number; sku: string; variantName: string }[];
}

interface BatchSummary {
  totalCount: number;
  thisMonthCount: number;
  recent: RecentBatch[];
}

interface RecentMovement {
  id: number;
  componentName: string;
  componentUnit: string;
  reason: string;
  quantityDelta: number;
  valueDeltaPence: number;
  occurredAt: Date;
}

interface RecentBatch {
  id: number;
  variantId: number;
  variantName: string;
  batchNumber: number;
  quantityMade: number;
  unitCostPenceAtProduction: number;
  producedAt: Date;
}

interface BelowReorderRow {
  id: number;
  name: string;
  unit: string;
  stockQuantity: number;
  reorderLevel: number;
}

interface MissingCostRow {
  id: number;
  name: string;
  unit: string;
}

interface NegativeStockRow {
  id: number;
  name: string;
  unit: string;
  stockQuantity: number;
}

export function getDashboardSummary(db: DbLike): DashboardSummary {
  // -- Components ------------------------------------------------------------
  const activeComponents = db
    .select()
    .from(components)
    .where(isNull(components.archived_at))
    .all();

  let componentValuePence = 0;
  let measuredCount = 0;
  let poolCount = 0;
  const belowReorder: BelowReorderRow[] = [];
  const missingCost: MissingCostRow[] = [];
  const negative: NegativeStockRow[] = [];

  for (const c of activeComponents) {
    if (c.unit === 'cost_pool') {
      poolCount += 1;
      componentValuePence += c.stock_value_pence ?? 0;
      if (c.reorder_level != null && (c.stock_value_pence ?? 0) < c.reorder_level) {
        belowReorder.push({
          id: c.id,
          name: c.name,
          unit: c.unit,
          stockQuantity: c.stock_value_pence ?? 0,
          reorderLevel: c.reorder_level,
        });
      }
      if ((c.stock_value_pence ?? 0) < 0) {
        negative.push({
          id: c.id,
          name: c.name,
          unit: c.unit,
          stockQuantity: c.stock_value_pence ?? 0,
        });
      }
    } else {
      measuredCount += 1;
      const qty = c.stock_quantity ?? 0;
      const cost = c.cost_per_unit_pence ?? 0;
      componentValuePence += qty * cost;
      if (c.cost_per_unit_pence == null) {
        missingCost.push({ id: c.id, name: c.name, unit: c.unit });
      }
      if (c.reorder_level != null && qty < c.reorder_level) {
        belowReorder.push({
          id: c.id,
          name: c.name,
          unit: c.unit,
          stockQuantity: qty,
          reorderLevel: c.reorder_level,
        });
      }
      if (qty < 0) {
        negative.push({ id: c.id, name: c.name, unit: c.unit, stockQuantity: qty });
      }
    }
  }

  // -- Variants --------------------------------------------------------------
  const activeVariants = db
    .select()
    .from(productVariants)
    .where(isNull(productVariants.archived_at))
    .all();

  let totalUnits = 0;
  let totalValueAtCostPence = 0;
  let totalValueAtRetailPence = 0;
  for (const v of activeVariants) {
    totalUnits += v.stock_quantity;
    totalValueAtCostPence += v.stock_quantity * (v.unit_cost_pence ?? 0);
    totalValueAtRetailPence += v.stock_quantity * v.price_pence;
  }

  // Variants that have no recipe rows at all.
  const recipeVariantIds = new Set(
    db.selectDistinct({ id: recipes.variant_id }).from(recipes).all().map((r) => r.id)
  );
  const missingRecipe = activeVariants
    .filter((v) => !recipeVariantIds.has(v.id))
    .map((v) => ({ id: v.id, sku: v.sku, variantName: v.variant_name }));

  // -- Batches ---------------------------------------------------------------
  const totalBatches = db.select({ id: batches.id }).from(batches).all().length;
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const thisMonthCount = db
    .select({ id: batches.id })
    .from(batches)
    .where(gte(batches.produced_at, startOfMonth))
    .all().length;

  const recent = db
    .select({
      id: batches.id,
      variantId: batches.variant_id,
      variantName: productVariants.variant_name,
      batchNumber: batches.batch_number,
      quantityMade: batches.quantity_made,
      unitCostPenceAtProduction: batches.unit_cost_pence_at_production,
      producedAt: batches.produced_at,
    })
    .from(batches)
    .innerJoin(productVariants, eq(productVariants.id, batches.variant_id))
    .orderBy(desc(batches.produced_at))
    .limit(5)
    .all();

  // -- Recent movements ------------------------------------------------------
  const recentMovements = db
    .select({
      id: stockMovements.id,
      componentName: components.name,
      componentUnit: components.unit,
      reason: stockMovements.reason,
      quantityDelta: stockMovements.quantity_delta,
      valueDeltaPence: stockMovements.value_delta_pence,
      occurredAt: stockMovements.occurred_at,
    })
    .from(stockMovements)
    .innerJoin(components, eq(components.id, stockMovements.component_id))
    .orderBy(desc(stockMovements.occurred_at))
    .limit(10)
    .all();

  // -- Stock targets ---------------------------------------------------------
  // Only variants with a target_stock set are tracked here.
  const targetedVariants = db
    .select({
      variantId: productVariants.id,
      productName: products.name,
      variantName: productVariants.variant_name,
      sku: productVariants.sku,
      currentStock: productVariants.stock_quantity,
      targetStock: productVariants.target_stock,
      pricePence: productVariants.price_pence,
      unitCostPence: productVariants.unit_cost_pence,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.product_id))
    .where(
      and(isNull(productVariants.archived_at), isNotNull(productVariants.target_stock))
    )
    .all();

  const stockTargets: StockTargetRow[] = targetedVariants
    .filter((v): v is typeof v & { targetStock: number } => v.targetStock != null)
    .map((v) => {
      const target = v.targetStock;
      const current = v.currentStock;
      const ratio = target > 0 ? current / target : 1;
      const deficit = Math.max(target - current, 0);
      let status: StockTargetRow['status'];
      if (current >= target) status = 'ok';
      else if (ratio >= 0.5) status = 'low';
      else status = 'needed';
      return {
        variantId: v.variantId,
        productName: v.productName,
        variantName: v.variantName,
        sku: v.sku,
        currentStock: current,
        targetStock: target,
        deficit,
        ratio,
        status,
      };
    })
    // Most-depleted first (lowest ratio at top), 'ok' rows sink to the bottom.
    .sort((a, b) => a.ratio - b.ratio);

  // -- Shopping list ---------------------------------------------------------
  // Aggregate the per-component need across every variant deficit, then
  // subtract the component's current on-hand to get the actual shortfall.
  interface NeedAggregate {
    qty: number;
    value: number; // for cost_pool components
    drivenBy: { variantId: number; variantName: string; deficit: number }[];
  }
  const need = new Map<number, NeedAggregate>();

  for (const v of targetedVariants) {
    if (v.targetStock == null) continue;
    const deficit = v.targetStock - v.currentStock;
    if (deficit <= 0) continue;

    const recipeRows = db
      .select({
        componentId: recipes.component_id,
        qtyPerUnit: recipes.quantity_per_unit,
        poolPerUnit: recipes.cost_pool_pence_per_unit,
        unit: components.unit,
      })
      .from(recipes)
      .innerJoin(components, eq(components.id, recipes.component_id))
      .where(eq(recipes.variant_id, v.variantId))
      .all();

    for (const r of recipeRows) {
      const cur = need.get(r.componentId) ?? { qty: 0, value: 0, drivenBy: [] };
      if (r.unit === 'cost_pool') {
        cur.value += (r.poolPerUnit ?? 0) * deficit;
      } else {
        cur.qty += (r.qtyPerUnit ?? 0) * deficit;
      }
      cur.drivenBy.push({
        variantId: v.variantId,
        variantName: `${v.productName} — ${v.variantName}`,
        deficit,
      });
      need.set(r.componentId, cur);
    }
  }

  const shoppingList: ShoppingListItem[] = [];
  if (need.size > 0) {
    const componentRows = db
      .select()
      .from(components)
      .where(inArray(components.id, Array.from(need.keys())))
      .all();
    for (const c of componentRows) {
      const n = need.get(c.id);
      if (!n) continue;

      if (c.unit === 'cost_pool') {
        const current = c.stock_value_pence ?? 0;
        const shortfallValue = Math.max(n.value - current, 0);
        if (shortfallValue <= 0) continue;
        shoppingList.push({
          componentId: c.id,
          componentName: c.name,
          componentColour: c.colour,
          componentSize: c.size,
          componentUnit: c.unit,
          packSize: null,
          link: c.link,
          totalNeededQty: 0,
          currentQty: null,
          shortfallQty: 0,
          packsNeeded: null,
          totalNeededValuePence: n.value,
          currentValuePence: current,
          shortfallValuePence: shortfallValue,
          estimatedCostPence: shortfallValue,
          drivenBy: n.drivenBy,
        });
      } else {
        const current = c.stock_quantity ?? 0;
        const shortfallQty = Math.max(n.qty - current, 0);
        if (shortfallQty <= 0) continue;
        const rate = c.cost_per_unit_pence ?? 0;
        const packsNeeded = c.pack_size ? Math.ceil(shortfallQty / c.pack_size) : null;
        // If the component comes in packs we can only buy whole packs, so the
        // realistic spend is packsNeeded * pack_size * unit cost, not strict
        // shortfall * unit cost.
        const purchaseQty =
          packsNeeded != null && c.pack_size != null ? packsNeeded * c.pack_size : shortfallQty;
        shoppingList.push({
          componentId: c.id,
          componentName: c.name,
          componentColour: c.colour,
          componentSize: c.size,
          componentUnit: c.unit,
          packSize: c.pack_size,
          link: c.link,
          totalNeededQty: n.qty,
          currentQty: current,
          shortfallQty,
          packsNeeded,
          totalNeededValuePence: 0,
          currentValuePence: null,
          shortfallValuePence: 0,
          estimatedCostPence: bankersRoundToPence(purchaseQty * rate),
          drivenBy: n.drivenBy,
        });
      }
    }
    shoppingList.sort((a, b) => b.estimatedCostPence - a.estimatedCostPence);
  }

  const shoppingListTotalPence = shoppingList.reduce(
    (sum, item) => sum + item.estimatedCostPence,
    0
  );

  // -- Target revenue --------------------------------------------------------
  // What we'd take in (and net) if every targeted variant hit its target
  // and sold through. Uses cached unit_cost_pence which already includes
  // labour via the recompute path.
  let targetRevenueTotal = 0;
  let targetCostTotal = 0;
  let deficitRevenueTotal = 0;
  let deficitProfitTotal = 0;
  for (const v of targetedVariants) {
    if (v.targetStock == null) continue;
    const unitCost = v.unitCostPence ?? 0;
    const unitProfit = v.pricePence - unitCost;
    targetRevenueTotal += v.targetStock * v.pricePence;
    targetCostTotal += v.targetStock * unitCost;
    const deficit = Math.max(v.targetStock - v.currentStock, 0);
    deficitRevenueTotal += deficit * v.pricePence;
    deficitProfitTotal += deficit * unitProfit;
  }
  const targetProfitTotal = targetRevenueTotal - targetCostTotal;
  const targetRevenue: TargetRevenueSummary = {
    totalRevenuePence: targetRevenueTotal,
    totalCostPence: targetCostTotal,
    totalProfitPence: targetProfitTotal,
    marginPct:
      targetRevenueTotal > 0 ? (targetProfitTotal / targetRevenueTotal) * 100 : null,
    deficitRevenuePence: deficitRevenueTotal,
    deficitProfitPence: deficitProfitTotal,
    targetedVariantCount: targetedVariants.filter((v) => v.targetStock != null).length,
  };

  return {
    components: {
      activeCount: activeComponents.length,
      measuredCount,
      poolCount,
      totalValuePence: bankersRoundToPence(componentValuePence),
      belowReorder,
      missingCost,
      negative,
    },
    variants: {
      activeCount: activeVariants.length,
      totalUnits,
      totalValueAtCostPence: bankersRoundToPence(totalValueAtCostPence),
      totalValueAtRetailPence,
      missingRecipe,
    },
    batches: {
      totalCount: totalBatches,
      thisMonthCount,
      recent,
    },
    stockTargets,
    targetRevenue,
    shoppingList,
    shoppingListTotalPence,
    recentMovements,
  };
}
