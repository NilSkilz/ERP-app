import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';

import { trpc } from '../../core/trpc.client';
import { MoneyPipe } from '../../core/money.pipe';

type ProductWithVariants = Awaited<
  ReturnType<typeof trpc.products.listWithVariants.query>
>[number];
type VariantRow = ProductWithVariants['variants'][number];

interface ProductForm {
  id: number | null; // null = creating
  name: string;
  category: string;
  description: string;
}

interface VariantForm {
  id: number | null; // null = creating
  productId: number | null;
  productName: string;
  sku: string;
  variantName: string;
  pricePounds: number | null;
  targetStock: number | null;
  labourHoursPerUnit: number | null;
  notes: string;
}

interface VariantAdjustForm {
  variantId: number;
  productName: string;
  variantName: string;
  currentStock: number;
  newStock: number | null;
}

@Component({
  selector: 'app-products-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    ConfirmDialogModule,
    MoneyPipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './products-page.component.html',
  styles: [
    `
      .page-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }
      h1 {
        margin: 0;
      }
      .dialog-form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .dialog-form label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.85rem;
        font-weight: 500;
      }
      .product-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .product-card {
        border: 1px solid #2a2b34;
        border-radius: 14px;
        background: #1b1c23;
        overflow: hidden;
      }
      .product-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 0.75rem;
        padding: 0.6rem 0.75rem;
      }
      .product-name {
        font-weight: 600;
      }
      .product-sub {
        color: #9a9fa9;
      }
      .product-actions {
        display: flex;
        gap: 0.25rem;
        align-items: center;
      }
      .product-body {
        padding: 0.75rem 1rem 1rem 2.25rem;
        background: #191a21;
        border-top: 1px solid #2a2b34;
      }
      .chevron-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 0.4rem 0.5rem;
        border-radius: 10px;
        color: inherit;
      }
      .chevron-btn:hover {
        background: #2a2b34;
      }
    `,
  ],
})
export class ProductsPageComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  readonly groups = signal<ProductWithVariants[]>([]);
  readonly loading = signal(false);
  readonly expandedRows = signal<Record<number, boolean>>({});

  readonly productOpen = signal(false);
  readonly productForm = signal<ProductForm>(this.emptyProductForm());

  readonly variantOpen = signal(false);
  readonly variantForm = signal<VariantForm | null>(null);

  readonly variantStockOpen = signal(false);
  readonly variantStockForm = signal<VariantAdjustForm | null>(null);

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.groups.set(await trpc.products.listWithVariants.query());
    } finally {
      this.loading.set(false);
    }
  }

  marginPct(variant: ProductWithVariants['variants'][number]): number | null {
    if (variant.unit_cost_pence == null || !variant.price_pence) return null;
    return ((variant.price_pence - variant.unit_cost_pence) / variant.price_pence) * 100;
  }

  // Colour the current stock number against the target, same thresholds as
  // the dashboard's stock-vs-target list. Returns '' for untargeted variants.
  stockColor(variant: ProductWithVariants['variants'][number]): string {
    const target = variant.target_stock;
    if (target == null || target <= 0) return '';
    const stock = variant.stock_quantity;
    if (stock >= target) return '#5fb87f'; // ok
    if (stock >= target * 0.5) return '#facc15'; // low
    return '#f43f5e'; // needed
  }

  toggleRow(product: ProductWithVariants): void {
    this.expandedRows.update((rows) => {
      const next = { ...rows };
      if (next[product.id]) {
        delete next[product.id];
      } else {
        next[product.id] = true;
      }
      console.log('[products] toggle row', product.id, '→', next);
      return next;
    });
  }

  isExpanded(product: ProductWithVariants): boolean {
    return !!this.expandedRows()[product.id];
  }

  openCreateProduct(): void {
    this.productForm.set(this.emptyProductForm());
    this.productOpen.set(true);
  }

  openEditProduct(product: ProductWithVariants): void {
    this.productForm.set({
      id: product.id,
      name: product.name,
      category: product.category ?? '',
      description: product.description ?? '',
    });
    this.productOpen.set(true);
  }

  async submitProduct(): Promise<void> {
    const f = this.productForm();
    try {
      if (f.id == null) {
        await trpc.products.create.mutate({
          name: f.name,
          category: f.category.trim() || null,
          description: f.description.trim() || null,
        });
      } else {
        await trpc.products.update.mutate({
          id: f.id,
          patch: {
            name: f.name,
            category: f.category.trim() || null,
            description: f.description.trim() || null,
          },
        });
      }
      this.productOpen.set(false);
      this.messageService.add({
        severity: 'success',
        summary: f.id == null ? 'Product created' : 'Product updated',
        life: 2000,
      });
      await this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  deleteProduct(product: ProductWithVariants): void {
    const variantNote =
      product.variants.length > 0
        ? ` Its ${product.variants.length} variant(s) will also be archived.`
        : '';
    this.confirmation.confirm({
      message: `Delete "${product.name}"?${variantNote} Existing batches and stock history are preserved.`,
      header: 'Confirm delete',
      icon: 'pi pi-exclamation-triangle',
      accept: async () => {
        try {
          await trpc.products.archive.mutate({ id: product.id });
          this.messageService.add({ severity: 'success', summary: 'Deleted', life: 2000 });
          await this.refresh();
        } catch (err) {
          this.fail(err);
        }
      },
    });
  }

  openCreateVariant(product: ProductWithVariants): void {
    this.variantForm.set({
      id: null,
      productId: product.id,
      productName: product.name,
      sku: '',
      variantName: '',
      pricePounds: null,
      targetStock: null,
      labourHoursPerUnit: null,
      notes: '',
    });
    this.variantOpen.set(true);
  }

  openEditVariant(product: ProductWithVariants, variant: VariantRow): void {
    this.variantForm.set({
      id: variant.id,
      productId: product.id,
      productName: product.name,
      sku: variant.sku,
      variantName: variant.variant_name,
      pricePounds: variant.price_pence / 100,
      targetStock: variant.target_stock,
      labourHoursPerUnit: variant.labour_hours_per_unit,
      notes: variant.notes ?? '',
    });
    this.variantOpen.set(true);
  }

  async submitVariant(): Promise<void> {
    const f = this.variantForm();
    if (!f || f.productId == null) return;
    if (f.pricePounds == null || f.pricePounds < 0) {
      this.messageService.add({ severity: 'warn', summary: 'Enter a price', life: 2500 });
      return;
    }
    const skuTrimmed = f.sku.trim();
    try {
      if (f.id == null) {
        await trpc.products.createVariant.mutate({
          productId: f.productId,
          // Empty string -> backend auto-generates the SKU.
          ...(skuTrimmed ? { sku: skuTrimmed } : {}),
          variantName: f.variantName,
          pricePence: Math.round(f.pricePounds * 100),
          targetStock: f.targetStock,
          labourHoursPerUnit: f.labourHoursPerUnit,
          notes: f.notes.trim() || null,
        });
      } else {
        if (!skuTrimmed) {
          this.messageService.add({
            severity: 'warn',
            summary: 'SKU is required when editing an existing variant',
            life: 2500,
          });
          return;
        }
        await trpc.products.updateVariant.mutate({
          id: f.id,
          patch: {
            sku: skuTrimmed,
            variantName: f.variantName,
            pricePence: Math.round(f.pricePounds * 100),
            targetStock: f.targetStock,
            labourHoursPerUnit: f.labourHoursPerUnit,
            notes: f.notes.trim() || null,
          },
        });
      }
      this.variantOpen.set(false);
      this.messageService.add({
        severity: 'success',
        summary: f.id == null ? 'Variant created' : 'Variant updated',
        life: 2000,
      });
      await this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  openAdjustVariantStock(product: ProductWithVariants, variant: VariantRow): void {
    this.variantStockForm.set({
      variantId: variant.id,
      productName: product.name,
      variantName: variant.variant_name,
      currentStock: variant.stock_quantity,
      newStock: variant.stock_quantity,
    });
    this.variantStockOpen.set(true);
  }

  async submitAdjustVariantStock(): Promise<void> {
    const f = this.variantStockForm();
    if (!f) return;
    if (f.newStock == null || f.newStock < 0 || !Number.isInteger(f.newStock)) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Enter a non-negative whole number',
        life: 2500,
      });
      return;
    }
    if (f.newStock === f.currentStock) {
      this.messageService.add({ severity: 'info', summary: 'No change', life: 2000 });
      return;
    }
    try {
      await trpc.products.adjustVariantStock.mutate({
        variantId: f.variantId,
        newQuantity: f.newStock,
      });
      this.variantStockOpen.set(false);
      this.messageService.add({
        severity: 'success',
        summary: `Stock set to ${f.newStock}`,
        life: 2000,
      });
      await this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  deleteVariant(variant: VariantRow): void {
    this.confirmation.confirm({
      message: `Delete variant "${variant.variant_name}"? Existing batches and stock history are preserved.`,
      header: 'Confirm delete',
      icon: 'pi pi-exclamation-triangle',
      accept: async () => {
        try {
          await trpc.products.archiveVariant.mutate({ id: variant.id });
          this.messageService.add({ severity: 'success', summary: 'Deleted', life: 2000 });
          await this.refresh();
        } catch (err) {
          this.fail(err);
        }
      },
    });
  }

  private emptyProductForm(): ProductForm {
    return { id: null, name: '', category: '', description: '' };
  }

  openVariantDetail(variantId: number): void {
    void this.router.navigate(['/products', variantId]);
  }

  private fail(err: unknown): void {
    console.error(err);
    this.messageService.add({
      severity: 'error',
      summary: 'Something went wrong',
      detail: err instanceof Error ? err.message : String(err),
      life: 4000,
    });
  }
}
