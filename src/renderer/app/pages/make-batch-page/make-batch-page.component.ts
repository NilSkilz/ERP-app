import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';

import { trpc } from '../../core/trpc.client';
import { MoneyPipe } from '../../core/money.pipe';
import { UnitQuantityPipe } from '../../core/unit-quantity.pipe';

type ProductWithVariants = Awaited<
  ReturnType<typeof trpc.products.listWithVariants.query>
>[number];
type Preview = Awaited<ReturnType<typeof trpc.batches.preview.query>>;

@Component({
  selector: 'app-make-batch-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    InputNumberModule,
    InputTextModule,
    TableModule,
    TagModule,
    MoneyPipe,
    UnitQuantityPipe,
  ],
  templateUrl: './make-batch-page.component.html',
  styles: [
    `
      h1 {
        margin: 0 0 1rem;
      }
      .controls {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) 160px auto;
        gap: 0.75rem;
        align-items: end;
        margin-bottom: 1.5rem;
        max-width: 720px;
      }
      .controls label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.85rem;
        font-weight: 500;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 1rem;
        margin-bottom: 1.25rem;
        padding: 1rem 1.25rem;
        background: var(--p-surface-50, #f7f8fa);
        border-radius: 8px;
      }
      .summary > div {
        display: flex;
        flex-direction: column;
      }
      .summary label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--p-text-muted-color, #9a9fa9);
      }
      .summary strong {
        font-size: 1.15rem;
      }
      .warning {
        color: var(--p-red-600, #dc2626);
      }
    `,
  ],
})
export class MakeBatchPageComponent implements OnInit {
  private readonly messageService = inject(MessageService);

  readonly variantOptions = signal<{ label: string; value: number }[]>([]);
  readonly selectedVariantId = signal<number | null>(null);
  readonly quantity = signal<number | null>(1);
  readonly notes = signal('');

  readonly preview = signal<Preview | null>(null);
  readonly previewing = signal(false);
  readonly making = signal(false);

  readonly hasWarnings = computed(() => (this.preview()?.warnings.length ?? 0) > 0);

  async ngOnInit(): Promise<void> {
    const groups = await trpc.products.listWithVariants.query();
    const opts: { label: string; value: number }[] = [];
    for (const p of groups as ProductWithVariants[]) {
      for (const v of p.variants) {
        opts.push({ label: `${p.name} — ${v.variant_name} (${v.sku})`, value: v.id });
      }
    }
    this.variantOptions.set(opts);
  }

  async refreshPreview(): Promise<void> {
    const variantId = this.selectedVariantId();
    const qty = this.quantity();
    if (variantId == null || qty == null || qty <= 0) {
      this.preview.set(null);
      return;
    }
    this.previewing.set(true);
    try {
      const p = await trpc.batches.preview.query({ variantId, quantity: qty });
      this.preview.set(p);
    } catch (err) {
      this.fail(err);
    } finally {
      this.previewing.set(false);
    }
  }

  async makeIt(): Promise<void> {
    const variantId = this.selectedVariantId();
    const qty = this.quantity();
    if (variantId == null || qty == null || qty <= 0) return;
    this.making.set(true);
    try {
      const res = await trpc.batches.make.mutate({
        variantId,
        quantity: qty,
        notes: this.notes().trim() || null,
      });
      this.messageService.add({
        severity: 'success',
        summary: `Made ${res.variantName} #${res.batchNumber}`,
        detail: `${res.quantityMade} units @ ${(res.unitCostPenceAtProduction / 100).toFixed(2)} each`,
        life: 4000,
      });
      if (res.warnings.length > 0) {
        const list = res.warnings.map((w) => w.componentName).join(', ');
        this.messageService.add({
          severity: 'warn',
          summary: 'Negative stock',
          detail: `These components are now negative: ${list}`,
          life: 8000,
        });
      }
      this.preview.set(null);
      this.quantity.set(1);
      this.notes.set('');
    } catch (err) {
      this.fail(err);
    } finally {
      this.making.set(false);
    }
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
