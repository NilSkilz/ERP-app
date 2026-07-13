import { z } from 'zod';
import { app } from 'electron';
import { UNITS } from '../../shared/units.js';
import {
  adjustComponentStock,
  createComponent,
  getComponent,
  listComponents,
  purchaseComponent,
  updateComponent,
} from '../domain/components.js';
import {
  adjustVariantStock,
  archiveProduct,
  archiveVariant,
  createProduct,
  createVariant,
  getVariant,
  listProducts,
  listProductsWithVariants,
  listVariantsForProduct,
  updateProduct,
  updateVariant,
  updateVariantBuildNotes,
} from '../domain/products.js';
import {
  addVariantAttachment,
  deleteVariantAttachment,
  listVariantAttachments,
  updateAttachmentCaption,
} from '../domain/attachments.js';
import { getSettings, updateSettings } from '../domain/settings.js';
import {
  deleteRecipeRow,
  listRecipeRows,
  upsertRecipeRow,
} from '../domain/recipes.js';
import {
  listBatches,
  listStockMovements,
  makeBatch,
  previewBatch,
} from '../domain/batches.js';
import { getDashboardSummary } from '../domain/dashboard.js';
import { publicProcedure, router } from './trpc.js';

const unitSchema = z.enum(UNITS);

const componentsRouter = router({
  list: publicProcedure.query(({ ctx }) => listComponents(ctx.db)),
  get: publicProcedure.input(z.object({ id: z.number().int() })).query(({ ctx, input }) =>
    getComponent(ctx.db, input.id)
  ),
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        sku: z.string().nullable().optional(),
        unit: unitSchema,
        link: z.string().url().nullable().optional().or(z.literal('').transform(() => null)),
        colour: z.string().nullable().optional(),
        size: z.string().nullable().optional(),
        packSize: z.number().int().positive().nullable().optional(),
        stockQuantity: z.number().nullable().optional(),
        stockValuePence: z.number().int().nullable().optional(),
        costPerUnitPence: z.number().nullable().optional(),
        reorderLevel: z.number().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => createComponent(ctx.db, input)),
  update: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        patch: z.object({
          name: z.string().min(1).optional(),
          sku: z.string().nullable().optional(),
          link: z.string().url().nullable().optional().or(z.literal('').transform(() => null)),
          colour: z.string().nullable().optional(),
          size: z.string().nullable().optional(),
          packSize: z.number().int().positive().nullable().optional(),
          unit: unitSchema.optional(),
          costPerUnitPence: z.number().nullable().optional(),
          reorderLevel: z.number().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      })
    )
    .mutation(({ ctx, input }) => updateComponent(ctx.db, input.id, input.patch)),
  purchase: publicProcedure
    .input(
      z.object({
        componentId: z.number().int(),
        quantity: z.number().positive().optional(),
        totalCostPence: z.number().int().min(0),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => purchaseComponent(ctx.db, input)),
  adjust: publicProcedure
    .input(
      z.object({
        componentId: z.number().int(),
        quantityDelta: z.number().optional(),
        valueDeltaPence: z.number().int().optional(),
        reason: z.enum(['adjustment', 'waste']).optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => adjustComponentStock(ctx.db, input)),
});

const productsRouter = router({
  list: publicProcedure.query(({ ctx }) => listProducts(ctx.db)),
  listWithVariants: publicProcedure.query(({ ctx }) => listProductsWithVariants(ctx.db)),
  variants: publicProcedure
    .input(z.object({ productId: z.number().int() }))
    .query(({ ctx, input }) => listVariantsForProduct(ctx.db, input.productId)),
  getVariant: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .query(({ ctx, input }) => getVariant(ctx.db, input.id)),
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        category: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => createProduct(ctx.db, input)),
  update: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        patch: z.object({
          name: z.string().min(1).optional(),
          category: z.string().nullable().optional(),
          description: z.string().nullable().optional(),
        }),
      })
    )
    .mutation(({ ctx, input }) => updateProduct(ctx.db, input.id, input.patch)),
  archive: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ ctx, input }) => archiveProduct(ctx.db, input.id)),
  archiveVariant: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ ctx, input }) => archiveVariant(ctx.db, input.id)),
  updateBuildNotes: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        buildNotes: z.string().nullable(),
      })
    )
    .mutation(({ ctx, input }) => updateVariantBuildNotes(ctx.db, input.id, input.buildNotes)),
  adjustVariantStock: publicProcedure
    .input(
      z.object({
        variantId: z.number().int(),
        newQuantity: z.number().int().min(0),
      })
    )
    .mutation(({ ctx, input }) => adjustVariantStock(ctx.db, input)),
  createVariant: publicProcedure
    .input(
      z.object({
        productId: z.number().int(),
        // Blank -> auto-generated from product+variant name on the backend.
        sku: z.string().optional(),
        variantName: z.string().min(1),
        pricePence: z.number().int().min(0),
        targetStock: z.number().int().min(0).nullable().optional(),
        labourHoursPerUnit: z.number().min(0).nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => createVariant(ctx.db, input)),
  updateVariant: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        patch: z.object({
          variantName: z.string().min(1).optional(),
          sku: z.string().min(1).optional(),
          pricePence: z.number().int().min(0).optional(),
          targetStock: z.number().int().min(0).nullable().optional(),
          labourHoursPerUnit: z.number().min(0).nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      })
    )
    .mutation(({ ctx, input }) => updateVariant(ctx.db, input.id, input.patch)),
});

const recipesRouter = router({
  list: publicProcedure
    .input(z.object({ variantId: z.number().int() }))
    .query(({ ctx, input }) => listRecipeRows(ctx.db, input.variantId)),
  upsert: publicProcedure
    .input(
      z.object({
        variantId: z.number().int(),
        componentId: z.number().int(),
        quantityPerUnit: z.number().nullable().optional(),
        costPoolPencePerUnit: z.number().int().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => upsertRecipeRow(ctx.db, input)),
  remove: publicProcedure
    .input(z.object({ recipeId: z.number().int() }))
    .mutation(({ ctx, input }) => deleteRecipeRow(ctx.db, input.recipeId)),
});

const batchesRouter = router({
  list: publicProcedure.query(({ ctx }) => listBatches(ctx.db)),
  preview: publicProcedure
    .input(z.object({ variantId: z.number().int(), quantity: z.number().int().positive() }))
    .query(({ ctx, input }) => previewBatch(ctx.db, input)),
  make: publicProcedure
    .input(
      z.object({
        variantId: z.number().int(),
        quantity: z.number().int().positive(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => makeBatch(ctx.db, input)),
});

const attachmentsRouter = router({
  list: publicProcedure
    .input(z.object({ variantId: z.number().int() }))
    .query(({ ctx, input }) => listVariantAttachments(ctx.db, input.variantId)),
  add: publicProcedure
    .input(
      z.object({
        variantId: z.number().int(),
        filename: z.string().min(1),
        mimeType: z.string().min(1),
        // tRPC + superjson serialises Uint8Array natively; zod 3 accepts it
        // as a custom value via z.instanceof.
        data: z.instanceof(Uint8Array),
        caption: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => addVariantAttachment(ctx.db, input)),
  remove: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ ctx, input }) => deleteVariantAttachment(ctx.db, input.id)),
  updateCaption: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        caption: z.string().nullable(),
      })
    )
    .mutation(({ ctx, input }) => updateAttachmentCaption(ctx.db, input.id, input.caption)),
});

const stockMovementsRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          componentId: z.number().int().optional(),
          from: z.date().optional(),
          to: z.date().optional(),
          limit: z.number().int().positive().max(5000).optional(),
        })
        .optional()
    )
    .query(({ ctx, input }) => listStockMovements(ctx.db, input ?? {})),
});

const systemRouter = router({
  ping: publicProcedure.query(() => ({
    ok: true as const,
    dbPath: `${app.getPath('userData')}/craft.db`,
    now: new Date(),
  })),
  webAccess: publicProcedure.query(async () => {
    // Lazy import so the renderer's type chain doesn't pull electron in.
    const main = await import('../index.js');
    return {
      urls: main.webServerInfo?.urls ?? [],
      apiPort: main.webServerInfo?.apiPort ?? null,
      rendererPort: main.webServerInfo?.rendererPort ?? null,
    };
  }),
});

const dashboardRouter = router({
  summary: publicProcedure.query(({ ctx }) => getDashboardSummary(ctx.db)),
});

const settingsRouter = router({
  get: publicProcedure.query(({ ctx }) => getSettings(ctx.db)),
  update: publicProcedure
    .input(
      z.object({
        labourHourlyRatePence: z.number().int().min(0).optional(),
      })
    )
    .mutation(({ ctx, input }) => updateSettings(ctx.db, input)),
});

export const appRouter = router({
  system: systemRouter,
  dashboard: dashboardRouter,
  settings: settingsRouter,
  components: componentsRouter,
  products: productsRouter,
  recipes: recipesRouter,
  batches: batchesRouter,
  attachments: attachmentsRouter,
  stockMovements: stockMovementsRouter,
});

export type AppRouter = typeof appRouter;
