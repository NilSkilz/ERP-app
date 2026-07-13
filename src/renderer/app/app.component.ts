import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router, NavigationEnd, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { trpc } from './core/trpc.client';

interface NavItem {
  label: string;
  icon: string;
  path: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastModule],
  template: `
    <div class="shell">
      <!-- Tide ambient glow: coral upper-left, sea-blue lower-right, breathing behind everything. -->
      <div class="glow" aria-hidden="true"></div>
      <div
        class="backdrop"
        [class.open]="drawerOpen()"
        (click)="closeDrawer()"
        aria-hidden="true"
      ></div>
      <aside class="sidebar" [class.open]="drawerOpen()">
        <div class="brand">
          <i class="pi pi-box"></i>
          <span class="tide-grad-text">Craft ERP</span>
        </div>
        <nav>
          @for (item of navItems; track item.path) {
            <a
              class="nav-link"
              [routerLink]="['/' + item.path]"
              routerLinkActive="active"
              (click)="closeDrawer()"
            >
              <i [class]="'pi ' + item.icon"></i>
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>
        <div class="footer">
          @if (dbPath()) {
            <small title="{{ dbPath() }}">DB: {{ dbPath() }}</small>
          }
        </div>
      </aside>
      <main class="content">
        <button
          type="button"
          class="hamburger"
          (click)="toggleDrawer()"
          [attr.aria-expanded]="drawerOpen()"
          aria-label="Menu"
        >
          <i class="pi pi-bars"></i>
        </button>
        <router-outlet />
      </main>
    </div>
    <p-toast [position]="toastPosition()" />
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .shell {
        display: grid;
        grid-template-columns: 220px 1fr;
        height: 100%;
        background: var(--ground);
        position: relative;
        overflow: hidden;
      }

      /* ambient glow behind everything, breathing on a slow loop */
      .glow {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
        z-index: 0;
      }
      .glow::before,
      .glow::after {
        content: '';
        position: absolute;
        border-radius: 50%;
        filter: blur(52px);
        animation: tide-breathe 14s ease-in-out infinite;
      }
      .glow::before {
        width: 60%;
        height: 55%;
        left: -12%;
        top: -14%;
        background: radial-gradient(circle, var(--glow-coral), transparent 70%);
      }
      .glow::after {
        width: 55%;
        height: 52%;
        right: -12%;
        bottom: -18%;
        background: radial-gradient(circle, var(--glow-blue), transparent 70%);
        animation-delay: -7s;
      }
      @keyframes tide-breathe {
        0%,
        100% {
          transform: scale(1) translate(0, 0);
          opacity: 0.9;
        }
        50% {
          transform: scale(1.12) translate(2%, 2%);
          opacity: 1;
        }
      }

      .backdrop {
        display: none;
      }
      .hamburger {
        display: none;
      }
      .sidebar {
        position: relative;
        z-index: 2;
        background: color-mix(in srgb, var(--ground) 78%, transparent);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border-right: 1px solid var(--hair);
        display: flex;
        flex-direction: column;
        padding: 1.25rem 0.6rem;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0 0.6rem 1.5rem;
        font-weight: 800;
        font-size: 1rem;
        letter-spacing: -0.01em;
      }
      .brand i {
        color: var(--accent);
        font-size: 1.05rem;
      }
      nav {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        flex: 1;
      }
      .nav-link {
        display: flex;
        align-items: center;
        gap: 0.7rem;
        padding: 0.6rem 0.75rem;
        border-radius: 10px;
        color: var(--muted);
        text-decoration: none;
        font-size: 0.88rem;
        font-weight: 600;
        transition:
          background 150ms ease,
          color 150ms ease;
      }
      .nav-link:hover {
        background: var(--surface-2);
        color: var(--ink);
      }
      .nav-link.active {
        background: var(--accent-soft);
        color: var(--accent);
        font-weight: 700;
      }
      .nav-link.active i {
        color: var(--accent);
      }
      .footer {
        padding: 0.5rem 0.7rem;
        color: var(--faint);
        font-size: 0.68rem;
        word-break: break-all;
        font-family:
          ui-monospace,
          'SF Mono',
          Menlo,
          monospace;
      }
      .content {
        position: relative;
        z-index: 1;
        overflow: auto;
        padding: 1.75rem 2.25rem;
      }

      /* --- Mobile (≤767px): collapse sidebar into a slide-in drawer --- */
      @media (max-width: 767px) {
        .shell {
          grid-template-columns: 1fr;
        }
        .sidebar {
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          width: 240px;
          z-index: 100;
          transform: translateX(-100%);
          transition: transform 0.2s ease;
          background: color-mix(in srgb, var(--ground) 92%, transparent);
          border-right: 1px solid var(--hair);
        }
        .sidebar.open {
          transform: translateX(0);
          box-shadow: 2px 0 16px rgba(0, 0, 0, 0.6);
        }
        .backdrop {
          display: block;
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          z-index: 90;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s ease;
        }
        .backdrop.open {
          opacity: 1;
          pointer-events: auto;
        }
        .hamburger {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 10px;
          color: var(--ink);
          cursor: pointer;
          margin-bottom: 1rem;
          font-size: 1.05rem;
        }
        .hamburger:active {
          background: var(--surface-2);
        }
        .content {
          padding: 1rem 1rem 2rem;
        }
      }
    `,
  ],
})
export class AppComponent implements OnInit {
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);

  readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'pi-th-large', path: 'dashboard' },
    { label: 'Components', icon: 'pi-box', path: 'components' },
    { label: 'Products', icon: 'pi-tags', path: 'products' },
    { label: 'Make a batch', icon: 'pi-cog', path: 'make-batch' },
    { label: 'Stock log', icon: 'pi-list', path: 'stock-log' },
    { label: 'Settings', icon: 'pi-sliders-h', path: 'settings' },
  ];

  readonly dbPath = signal<string | null>(null);
  readonly drawerOpen = signal(false);
  readonly toastPosition = signal<'bottom-right' | 'bottom-center'>('bottom-right');

  constructor() {
    // Belt-and-braces: also close the drawer if navigation happens via any
    // route change (link clicks, programmatic, back/forward).
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.drawerOpen.set(false));

    this.updateForViewport();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.updateForViewport());
    }
  }

  toggleDrawer(): void {
    this.drawerOpen.update((v) => !v);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  private updateForViewport(): void {
    if (typeof window === 'undefined') return;
    // Centred toast on mobile so it stays in thumb reach above the on-screen
    // keyboard (Safari pushes bottom-right under the URL bar).
    const isMobile = window.innerWidth <= 767;
    this.toastPosition.set(isMobile ? 'bottom-center' : 'bottom-right');
    if (!isMobile) this.drawerOpen.set(false);
  }

  async ngOnInit(): Promise<void> {
    try {
      const res = await trpc.system.ping.query();
      this.dbPath.set(res.dbPath);
      console.log('[renderer] ping ok', res);
    } catch (err) {
      console.error('[renderer] ping failed', err);
      this.messageService.add({
        severity: 'error',
        summary: 'IPC failed',
        detail: 'Could not reach the main process. See devtools for details.',
        life: 5000,
      });
    }
  }
}
