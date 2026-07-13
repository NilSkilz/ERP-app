import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageService } from 'primeng/api';

import { isElectron, trpc } from '../../core/trpc.client';
import { MoneyPipe } from '../../core/money.pipe';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonModule, InputNumberModule, MoneyPipe],
  template: `
    <h1>Settings</h1>

    <section class="card" style="margin-bottom: 1rem;">
      <h2>Web access</h2>
      <p class="muted">
        The desktop app exposes an HTTP server on the same data so you can use it from
        another device on your Wi-Fi (iPhone, laptop, iPad…). Type one of the URLs
        below into Safari on your phone.
      </p>
      <p class="muted" style="color: var(--p-red-500, #f43f5e);">
        ⚠ Anyone on your network can reach this. Don't expose it to public Wi-Fi.
      </p>
      @if (webUrls().length === 0) {
        <em>No URLs reported. The server may not have started — check the terminal.</em>
      } @else {
        <ul class="url-list">
          @for (url of webUrls(); track url) {
            <li><code>{{ url }}</code></li>
          }
        </ul>
      }
    </section>

    <section class="card">
      <h2>Labour rate</h2>
      <p class="muted">
        Used together with each variant's "Labour hours per unit" to roll labour into the
        unit cost. Changing this recomputes every variant's cached cost.
      </p>
      <label>
        Hourly rate (£/hr)
        <p-inputNumber
          [(ngModel)]="hourlyRatePounds"
          mode="currency"
          currency="GBP"
          locale="en-GB"
          [minFractionDigits]="2"
          [maxFractionDigits]="2"
        />
      </label>
      @if (currentRatePence() != null) {
        <small class="muted">
          Currently saved: {{ currentRatePence() | money }}/hr
        </small>
      }
      <div class="actions">
        <p-button
          label="Save"
          icon="pi pi-check"
          [disabled]="!isDirty()"
          (onClick)="save()"
        />
        @if (isDirty()) {
          <p-button label="Discard" severity="secondary" text="true" (onClick)="reset()" />
        }
      </div>
    </section>
  `,
  styles: [
    `
      h1 {
        margin: 0 0 1.25rem;
      }
      .card {
        border: 1px solid #1f1f1f;
        border-radius: 4px;
        background: #131313;
        padding: 1.1rem 1.25rem;
        max-width: 520px;
      }
      .card h2 {
        margin: 0 0 0.4rem;
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
      .muted {
        color: #888;
        font-size: 0.85rem;
        margin: 0 0 1rem;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        font-size: 0.85rem;
        font-weight: 500;
      }
      .actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 1rem;
      }
      .url-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .url-list code {
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 0.85rem;
        background: #0f0f0f;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        border: 1px solid #1f1f1f;
        color: #84cc16;
      }
    `,
  ],
})
export class SettingsPageComponent implements OnInit {
  private readonly messageService = inject(MessageService);

  readonly currentRatePence = signal<number | null>(null);
  readonly webUrls = signal<string[]>([]);
  hourlyRatePounds: number | null = null;

  async ngOnInit(): Promise<void> {
    try {
      const s = await trpc.settings.get.query();
      this.currentRatePence.set(s.labourHourlyRatePence);
      this.hourlyRatePounds = s.labourHourlyRatePence / 100;
    } catch (err) {
      this.fail(err);
    }
    try {
      // Only meaningful in Electron (the desktop has access to the LAN IPs).
      // Browser visitors already know the URL they used to get here.
      if (isElectron) {
        const info = await trpc.system.webAccess.query();
        this.webUrls.set(info.urls);
      } else if (typeof window !== 'undefined') {
        this.webUrls.set([window.location.origin]);
      }
    } catch (err) {
      console.warn('[settings] could not fetch web access info', err);
    }
  }

  isDirty(): boolean {
    if (this.hourlyRatePounds == null) return false;
    const current = (this.currentRatePence() ?? 0) / 100;
    return Math.abs(this.hourlyRatePounds - current) > 0.0001;
  }

  reset(): void {
    this.hourlyRatePounds = (this.currentRatePence() ?? 0) / 100;
  }

  async save(): Promise<void> {
    if (this.hourlyRatePounds == null || this.hourlyRatePounds < 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Enter a non-negative rate',
        life: 2500,
      });
      return;
    }
    try {
      const pence = Math.round(this.hourlyRatePounds * 100);
      const updated = await trpc.settings.update.mutate({ labourHourlyRatePence: pence });
      this.currentRatePence.set(updated.labourHourlyRatePence);
      this.messageService.add({
        severity: 'success',
        summary: 'Saved — all variant costs refreshed',
        life: 2500,
      });
    } catch (err) {
      this.fail(err);
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
