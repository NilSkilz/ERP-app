import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';

import { trpc } from '../../core/trpc.client';
import { MoneyPipe } from '../../core/money.pipe';
import { UnitQuantityPipe } from '../../core/unit-quantity.pipe';

type Summary = Awaited<ReturnType<typeof trpc.dashboard.summary.query>>;

const REASON_SEVERITY: Record<string, string> = {
  purchase: 'success',
  production: 'info',
  adjustment: 'warning',
  waste: 'danger',
  opening: 'secondary',
};

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    DatePipe,
    RouterLink,
    ButtonModule,
    TagModule,
    MoneyPipe,
    UnitQuantityPipe,
  ],
  templateUrl: './dashboard-page.component.html',
  styles: [
    `
      h1 {
        margin: 0 0 1rem;
      }
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.75rem;
        margin-bottom: 1.5rem;
      }
      .kpi {
        border: 1px solid #1f1f1f;
        border-radius: 4px;
        padding: 0.95rem 1.05rem;
        background: #131313;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .kpi-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #888;
        font-family:
          ui-monospace,
          'SF Mono',
          Menlo,
          monospace;
      }
      .kpi-value {
        font-size: 1.65rem;
        font-weight: 600;
        line-height: 1.1;
        font-family:
          ui-monospace,
          'SF Mono',
          Menlo,
          monospace;
        font-variant-numeric: tabular-nums;
      }
      .kpi-sub {
        font-size: 0.78rem;
        color: #888;
        font-family:
          ui-monospace,
          'SF Mono',
          Menlo,
          monospace;
      }
      .panels {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }
      @media (max-width: 900px) {
        .panels {
          grid-template-columns: 1fr;
        }
      }
      .panel {
        border: 1px solid #1f1f1f;
        border-radius: 4px;
        background: #131313;
        padding: 1rem 1.15rem;
      }
      .panel h2 {
        font-size: 0.85rem;
        margin: 0 0 0.6rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #888;
        font-family:
          ui-monospace,
          'SF Mono',
          Menlo,
          monospace;
        font-weight: 600;
      }
      .alert-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .alert-item {
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.4rem 0.5rem;
        border-radius: 6px;
        background: #1a1a1a;
        align-items: center;
        font-size: 0.9rem;
      }
      .alert-item a {
        color: var(--p-primary-color, #2563eb);
        text-decoration: none;
      }
      .alert-item a:hover {
        text-decoration: underline;
      }
      .alert-empty {
        font-size: 0.85rem;
        color: var(--p-text-muted-color, #6b7280);
        font-style: italic;
      }
      .activity-row {
        display: grid;
        grid-template-columns: 90px 1fr auto;
        gap: 0.5rem;
        align-items: center;
        padding: 0.35rem 0.25rem;
        border-bottom: 1px solid var(--p-surface-100, #f1f1f1);
        font-size: 0.85rem;
      }
      .activity-row:last-child {
        border-bottom: none;
      }
      .activity-when {
        color: var(--p-text-muted-color, #6b7280);
        font-size: 0.75rem;
      }
      .neg {
        color: var(--p-red-600, #dc2626);
      }
      .target-list {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .target-row {
        display: grid;
        grid-template-columns: 14px 1fr auto;
        align-items: center;
        gap: 0.6rem;
        padding: 0.45rem 0.5rem;
        border-radius: 6px;
        background: #1a1a1a;
        font-size: 0.88rem;
      }
      .target-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      .target-dot.ok {
        background: #84cc16;
        box-shadow: 0 0 8px #84cc16;
      }
      .target-dot.low {
        background: #facc15;
        box-shadow: 0 0 8px #facc15;
      }
      .target-dot.needed {
        background: #f43f5e;
        box-shadow: 0 0 8px #f43f5e;
      }
      .target-name {
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .target-sub {
        color: var(--p-text-muted-color, #6b7280);
        font-size: 0.75rem;
      }
      .target-numbers {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.1rem;
      }
      .target-need {
        font-weight: 600;
      }
      .target-need.ok {
        color: var(--p-green-700, #15803d);
      }
      .target-need.low {
        color: var(--p-amber-700, #b45309);
      }
      .target-need.needed {
        color: var(--p-red-700, #b91c1c);
      }
      .target-stock-line {
        font-size: 0.72rem;
        color: var(--p-text-muted-color, #6b7280);
      }

      /* --- Mobile (≤767px): stack everything that's too wide for narrow screens --- */
      @media (max-width: 767px) {
        .kpi-grid {
          grid-template-columns: 1fr;
        }
        .kpi-value {
          font-size: 1.4rem;
        }
        .shopping-row {
          grid-template-columns: 1fr auto;
          grid-template-areas:
            'name name'
            'buy link'
            'cost cost';
          gap: 0.4rem;
          padding: 0.75rem 0.25rem;
        }
        .shopping-row > :nth-child(1) {
          grid-area: name;
        }
        .shopping-row > :nth-child(2) {
          grid-area: buy;
        }
        .shopping-row > :nth-child(3) {
          grid-area: cost;
          text-align: left;
        }
        .shopping-row > :nth-child(4) {
          grid-area: link;
          justify-self: end;
        }
        .target-row {
          grid-template-columns: 14px 1fr auto;
        }
        .activity-row {
          grid-template-columns: 1fr;
          gap: 0.1rem;
          padding: 0.6rem 0.25rem;
        }
        .activity-row .activity-when {
          order: -1;
        }
      }
      .shopping-section {
        margin: 0 0 1rem;
      }
      .shopping-panel {
        border: 1px solid #1f1f1f;
        border-radius: 4px;
        background: #131313;
        padding: 1rem 1.15rem;
      }
      .shopping-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 0.6rem;
      }
      .shopping-header h2 {
        margin: 0;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #888;
        font-family:
          ui-monospace,
          'SF Mono',
          Menlo,
          monospace;
        font-weight: 600;
      }
      .shopping-row .shopping-cost,
      .shopping-row .shopping-buy {
        font-family:
          ui-monospace,
          'SF Mono',
          Menlo,
          monospace;
        font-variant-numeric: tabular-nums;
      }
      .shopping-header .total {
        font-size: 0.85rem;
        color: var(--p-text-muted-color, #6b7280);
      }
      .shopping-header .total strong {
        color: var(--p-text-color, #111827);
        font-weight: 600;
      }
      .shopping-row {
        display: grid;
        grid-template-columns: 1fr 130px 130px auto;
        gap: 0.6rem;
        align-items: center;
        padding: 0.5rem 0.25rem;
        border-bottom: 1px solid var(--p-surface-100, #f1f1f1);
        font-size: 0.88rem;
      }
      .shopping-row:last-child {
        border-bottom: none;
      }
      .shopping-name {
        font-weight: 500;
      }
      .shopping-meta {
        font-size: 0.72rem;
        color: var(--p-text-muted-color, #6b7280);
      }
      .shopping-buy {
        font-weight: 600;
      }
      .shopping-packs {
        font-size: 0.72rem;
        color: var(--p-text-muted-color, #6b7280);
      }
      .shopping-cost {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .shopping-link {
        color: var(--p-primary-color, #2563eb);
        text-decoration: none;
      }
      .shopping-link:hover {
        text-decoration: underline;
      }
      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 0.6rem;
      }
      .panel-header h2 {
        margin: 0;
      }
      .panel-header a {
        font-size: 0.8rem;
        color: var(--p-primary-color, #2563eb);
        text-decoration: none;
      }
    `,
  ],
})
export class DashboardPageComponent implements OnInit {
  private readonly messageService = inject(MessageService);

  readonly summary = signal<Summary | null>(null);
  readonly loading = signal(false);

  // Convenience getters for the template.
  readonly totalStockValue = computed(() => {
    const s = this.summary();
    if (!s) return 0;
    return s.components.totalValuePence + s.variants.totalValueAtCostPence;
  });

  readonly potentialMargin = computed(() => {
    const s = this.summary();
    if (!s) return null;
    const cost = s.variants.totalValueAtCostPence;
    const retail = s.variants.totalValueAtRetailPence;
    if (retail === 0) return null;
    return ((retail - cost) / retail) * 100;
  });

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.summary.set(await trpc.dashboard.summary.query());
    } catch (err) {
      console.error(err);
      this.messageService.add({
        severity: 'error',
        summary: 'Could not load dashboard',
        detail: err instanceof Error ? err.message : String(err),
        life: 4000,
      });
    } finally {
      this.loading.set(false);
    }
  }

  severity(reason: string): string {
    return REASON_SEVERITY[reason] ?? 'secondary';
  }

  componentLabel(parts: { colour?: string | null; size?: string | null; unit?: string | null }): string {
    const bits = [parts.colour, parts.size, parts.unit]
      .map((x) => (x ?? '').toString().trim())
      .filter(Boolean);
    return bits.length > 0 ? `(${bits.join(', ')})` : '';
  }
}
