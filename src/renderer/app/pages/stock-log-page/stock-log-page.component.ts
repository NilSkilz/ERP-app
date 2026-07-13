import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';

import { trpc } from '../../core/trpc.client';
import { MoneyPipe } from '../../core/money.pipe';
import { UnitQuantityPipe } from '../../core/unit-quantity.pipe';

type LogRow = Awaited<ReturnType<typeof trpc.stockMovements.list.query>>[number];

const REASON_SEVERITY: Record<string, string> = {
  purchase: 'success',
  production: 'info',
  adjustment: 'warning',
  waste: 'danger',
  opening: 'secondary',
};

@Component({
  selector: 'app-stock-log-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    TableModule,
    TagModule,
    MoneyPipe,
    UnitQuantityPipe,
  ],
  templateUrl: './stock-log-page.component.html',
  styles: [
    `
      h1 {
        margin: 0 0 1rem;
      }
      .filters {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) 180px 180px auto;
        gap: 0.75rem;
        align-items: end;
        margin-bottom: 1.25rem;
        max-width: 900px;
      }
      .filters label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.85rem;
        font-weight: 500;
      }
      .neg {
        color: var(--p-red-600, #dc2626);
      }
    `,
  ],
})
export class StockLogPageComponent implements OnInit {
  private readonly messageService = inject(MessageService);

  readonly componentOptions = signal<{ label: string; value: number | null }[]>([]);

  readonly componentId = signal<number | null>(null);
  readonly from = signal<Date | null>(null);
  readonly to = signal<Date | null>(null);

  readonly rows = signal<LogRow[]>([]);
  readonly loading = signal(false);

  readonly anyFilter = computed(
    () => this.componentId() != null || this.from() != null || this.to() != null
  );

  async ngOnInit(): Promise<void> {
    const components = await trpc.components.list.query();
    this.componentOptions.set([
      { label: 'All components', value: null },
      ...components.map((c) => ({ label: c.name, value: c.id })),
    ]);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(
        await trpc.stockMovements.list.query({
          componentId: this.componentId() ?? undefined,
          from: this.from() ?? undefined,
          to: this.to() ?? undefined,
        })
      );
    } catch (err) {
      console.error(err);
      this.messageService.add({
        severity: 'error',
        summary: 'Could not load',
        detail: err instanceof Error ? err.message : String(err),
        life: 4000,
      });
    } finally {
      this.loading.set(false);
    }
  }

  clearFilters(): void {
    this.componentId.set(null);
    this.from.set(null);
    this.to.set(null);
    void this.refresh();
  }

  severity(reason: string): string {
    return REASON_SEVERITY[reason] ?? 'secondary';
  }
}
