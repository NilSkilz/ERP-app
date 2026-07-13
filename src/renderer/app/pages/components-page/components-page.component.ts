import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';

import { trpc } from '../../core/trpc.client';
import { MoneyPipe } from '../../core/money.pipe';
import { UnitQuantityPipe } from '../../core/unit-quantity.pipe';
import { UNITS, quantityConversionFactor, type Unit } from '../../../../shared/units';

type ComponentRow = Awaited<ReturnType<typeof trpc.components.list.query>>[number];

interface CreateForm {
  name: string;
  sku: string;
  unit: Unit;
  link: string;
  colour: string;
  size: string;
  packSize: number | null;
  stockQuantity: number | null;
  // Entered in £ (with up to 4-decimal precision for sub-penny units).
  // Converted to pence on submit so the DB stays in integer/fractional pence.
  stockValuePounds: number | null;
  costPerUnitPounds: number | null;
  reorderLevel: number | null;
  notes: string;
}

interface EditForm {
  id: number;
  name: string;
  sku: string;
  link: string;
  colour: string;
  size: string;
  packSize: number | null;
  unit: Unit;
  originalUnit: Unit;
  costPerUnitPounds: number | null;
  reorderLevel: number | null;
  notes: string;
}

interface ReceiveForm {
  componentId: number;
  unit: Unit;
  name: string;
  packSize: number | null; // if set, the "packs" quick-fill is shown
  packs: number | null;
  quantity: number | null;
  totalCostPounds: number | null; // entered in pounds, converted to pence on submit
  notes: string;
}

interface AdjustForm {
  componentId: number;
  unit: Unit;
  name: string;
  // Current values shown to the user for reference.
  currentStockQuantity: number | null;
  currentStockValuePounds: number | null;
  // New values — for measured the quantity field is used, for cost_pool the
  // pounds field. The backend gets a delta computed at submit time.
  newStockQuantity: number | null;
  newStockValuePounds: number | null;
  reason: 'adjustment' | 'waste';
  notes: string;
}

@Component({
  selector: 'app-components-page',
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
    TagModule,
    MoneyPipe,
    UnitQuantityPipe,
  ],
  templateUrl: './components-page.component.html',
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
        min-width: 0;
      }
      // Stretch PrimeNG inputs to the full width of their grid/flex cell so
      // they don't push side-by-side fields past the dialog edge.
      .dialog-form :is(input, p-inputnumber, p-select),
      .dialog-form :is(.p-inputnumber, .p-select) {
        width: 100%;
      }
      .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
        min-width: 0;
      }
      .row-actions {
        display: flex;
        gap: 0.25rem;
        align-items: center;
      }
      .link-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 6px;
        color: var(--p-text-color, #374151);
        text-decoration: none;
      }
      .link-btn:hover {
        background: var(--p-surface-100, #f4f4f4);
        color: var(--p-primary-color, #2563eb);
      }
    `,
  ],
})
export class ComponentsPageComponent implements OnInit {
  private readonly messageService = inject(MessageService);

  readonly UNIT_OPTIONS = UNITS.map((u) => ({ label: u, value: u }));

  readonly rows = signal<ComponentRow[]>([]);
  readonly loading = signal(false);

  readonly createOpen = signal(false);
  readonly createForm = signal<CreateForm>(this.emptyCreate());

  readonly editOpen = signal(false);
  readonly editForm = signal<EditForm | null>(null);

  readonly receiveOpen = signal(false);
  readonly receiveForm = signal<ReceiveForm | null>(null);

  readonly receivingMeasured = computed(() => this.receiveForm()?.unit !== 'cost_pool');

  readonly adjustOpen = signal(false);
  readonly adjustForm = signal<AdjustForm | null>(null);

  readonly adjustingMeasured = computed(() => this.adjustForm()?.unit !== 'cost_pool');

  readonly REASON_OPTIONS = [
    { label: 'Adjustment (count correction)', value: 'adjustment' as const },
    { label: 'Waste (spillage, breakage)', value: 'waste' as const },
  ];

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const list = await trpc.components.list.query();
      this.rows.set(list);
    } finally {
      this.loading.set(false);
    }
  }

  valueOf(row: ComponentRow): number | null {
    if (row.unit === 'cost_pool') return row.stock_value_pence;
    if (row.stock_quantity == null || row.cost_per_unit_pence == null) return null;
    return Math.round(row.stock_quantity * row.cost_per_unit_pence);
  }

  // ------ Create ------
  openCreate(): void {
    this.createForm.set(this.emptyCreate());
    this.createOpen.set(true);
  }

  async submitCreate(): Promise<void> {
    const f = this.createForm();
    try {
      await trpc.components.create.mutate({
        name: f.name,
        sku: f.sku.trim() || null,
        unit: f.unit,
        link: f.link.trim() || null,
        colour: f.colour.trim() || null,
        size: f.size.trim() || null,
        packSize: f.unit === 'cost_pool' ? null : f.packSize,
        stockQuantity: f.unit === 'cost_pool' ? null : f.stockQuantity,
        stockValuePence:
          f.unit === 'cost_pool' && f.stockValuePounds != null
            ? Math.round(f.stockValuePounds * 100)
            : null,
        costPerUnitPence:
          f.unit === 'cost_pool' || f.costPerUnitPounds == null
            ? null
            : f.costPerUnitPounds * 100,
        reorderLevel: f.reorderLevel,
        notes: f.notes.trim() || null,
      });
      this.createOpen.set(false);
      this.messageService.add({ severity: 'success', summary: 'Component created', life: 2500 });
      await this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  // ------ Edit ------
  openEdit(row: ComponentRow): void {
    this.editForm.set({
      id: row.id,
      name: row.name,
      sku: row.sku ?? '',
      link: row.link ?? '',
      colour: row.colour ?? '',
      size: row.size ?? '',
      packSize: row.pack_size,
      unit: row.unit,
      originalUnit: row.unit,
      costPerUnitPounds:
        row.cost_per_unit_pence == null ? null : row.cost_per_unit_pence / 100,
      reorderLevel: row.reorder_level,
      notes: row.notes ?? '',
    });
    this.editOpen.set(true);
  }

  async submitEdit(): Promise<void> {
    const f = this.editForm();
    if (!f) return;
    const unitChanged = f.unit !== f.originalUnit;
    if (unitChanged) {
      const willConvert = this.unitChangeIsConversion(f);
      const msg = willConvert
        ? `Convert this component from "${f.originalUnit}" to "${f.unit}"? ` +
          `Your existing stock and cost will be auto-scaled.`
        : `Changing the unit from "${f.originalUnit}" to "${f.unit}" will reset stock ` +
          `fields for this component. Recipes that reference it may need to be ` +
          `updated. Continue?`;
      if (!window.confirm(msg)) return;
    }
    try {
      await trpc.components.update.mutate({
        id: f.id,
        patch: {
          name: f.name,
          sku: f.sku.trim() || null,
          link: f.link.trim() || null,
          colour: f.colour.trim() || null,
          size: f.size.trim() || null,
          packSize: f.unit === 'cost_pool' ? null : f.packSize,
          unit: f.unit,
          // Only send the cost if the unit isn't cost_pool — pool components
          // ignore the field anyway, and we want to avoid clobbering it.
          ...(f.unit === 'cost_pool'
            ? {}
            : {
                costPerUnitPence:
                  f.costPerUnitPounds == null ? null : f.costPerUnitPounds * 100,
              }),
          reorderLevel: f.reorderLevel,
          notes: f.notes.trim() || null,
        },
      });
      this.editOpen.set(false);
      this.messageService.add({ severity: 'success', summary: 'Saved', life: 2000 });
      await this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  // ------ Receive stock ------
  openReceive(row: ComponentRow): void {
    this.receiveForm.set({
      componentId: row.id,
      unit: row.unit,
      name: row.name,
      packSize: row.unit === 'cost_pool' ? null : row.pack_size,
      packs: null,
      quantity: null,
      totalCostPounds: null,
      notes: '',
    });
    this.receiveOpen.set(true);
  }

  // Quick-fill: typing packs auto-fills the quantity field. The quantity
  // remains editable so the user can override for partial packs.
  onPacksChange(): void {
    const f = this.receiveForm();
    if (!f || !f.packSize) return;
    if (f.packs == null) return;
    f.quantity = f.packs * f.packSize;
  }

  async submitReceive(): Promise<void> {
    const f = this.receiveForm();
    if (!f) return;
    if (f.totalCostPounds == null || f.totalCostPounds < 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Enter the total cost paid',
        life: 2500,
      });
      return;
    }
    if (f.unit !== 'cost_pool' && (!f.quantity || f.quantity <= 0)) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Enter a quantity > 0',
        life: 2500,
      });
      return;
    }
    try {
      await trpc.components.purchase.mutate({
        componentId: f.componentId,
        quantity: f.unit === 'cost_pool' ? undefined : f.quantity!,
        totalCostPence: Math.round(f.totalCostPounds * 100),
        notes: f.notes.trim() || null,
      });
      this.receiveOpen.set(false);
      this.messageService.add({
        severity: 'success',
        summary: `Stock received for ${f.name}`,
        life: 2500,
      });
      await this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  // ------ Adjust stock ------
  openAdjust(row: ComponentRow): void {
    const currentValuePounds = row.stock_value_pence == null ? null : row.stock_value_pence / 100;
    this.adjustForm.set({
      componentId: row.id,
      unit: row.unit,
      name: row.name,
      currentStockQuantity: row.stock_quantity,
      currentStockValuePounds: currentValuePounds,
      newStockQuantity: row.stock_quantity,
      newStockValuePounds: currentValuePounds,
      reason: 'adjustment',
      notes: '',
    });
    this.adjustOpen.set(true);
  }

  async submitAdjust(): Promise<void> {
    const f = this.adjustForm();
    if (!f) return;

    if (f.unit === 'cost_pool') {
      if (f.newStockValuePounds == null) {
        this.messageService.add({
          severity: 'warn',
          summary: 'Enter the new pool value',
          life: 2500,
        });
        return;
      }
      const newPence = Math.round(f.newStockValuePounds * 100);
      const currentPence = Math.round((f.currentStockValuePounds ?? 0) * 100);
      const delta = newPence - currentPence;
      if (delta === 0) {
        this.messageService.add({ severity: 'info', summary: 'No change', life: 2000 });
        return;
      }
      try {
        await trpc.components.adjust.mutate({
          componentId: f.componentId,
          valueDeltaPence: delta,
          reason: f.reason,
          notes: f.notes.trim() || null,
        });
      } catch (err) {
        this.fail(err);
        return;
      }
    } else {
      if (f.newStockQuantity == null) {
        this.messageService.add({
          severity: 'warn',
          summary: 'Enter the new stock quantity',
          life: 2500,
        });
        return;
      }
      const delta = f.newStockQuantity - (f.currentStockQuantity ?? 0);
      if (delta === 0) {
        this.messageService.add({ severity: 'info', summary: 'No change', life: 2000 });
        return;
      }
      try {
        await trpc.components.adjust.mutate({
          componentId: f.componentId,
          quantityDelta: delta,
          reason: f.reason,
          notes: f.notes.trim() || null,
        });
      } catch (err) {
        this.fail(err);
        return;
      }
    }

    this.adjustOpen.set(false);
    this.messageService.add({
      severity: 'success',
      summary: `Stock adjusted for ${f.name}`,
      life: 2500,
    });
    await this.refresh();
  }

  // ------ helpers ------
  unitChangeIsConversion(f: EditForm): boolean {
    if (f.unit === f.originalUnit) return false;
    return quantityConversionFactor(f.originalUnit, f.unit) != null;
  }

  private emptyCreate(): CreateForm {
    return {
      name: '',
      sku: '',
      unit: 'each',
      link: '',
      colour: '',
      size: '',
      packSize: null,
      stockQuantity: 0,
      stockValuePounds: 0,
      costPerUnitPounds: 0,
      reorderLevel: null,
      notes: '',
    };
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
