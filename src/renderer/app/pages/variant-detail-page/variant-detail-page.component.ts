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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { MessageService, ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

import { assetUrl, trpc } from '../../core/trpc.client';
import { MoneyPipe } from '../../core/money.pipe';
import { UnitQuantityPipe } from '../../core/unit-quantity.pipe';

type Variant = Awaited<ReturnType<typeof trpc.products.getVariant.query>>;
type RecipeRow = Awaited<ReturnType<typeof trpc.recipes.list.query>>[number];
type ComponentRow = Awaited<ReturnType<typeof trpc.components.list.query>>[number];
type Attachment = Awaited<ReturnType<typeof trpc.attachments.list.query>>[number];

interface RecipeForm {
  recipeId: number | null;
  componentId: number | null;
  componentName: string;
  componentUnit: string;
  quantityPerUnit: number | null;
  costPoolPencePerUnit: number | null;
  notes: string;
}

@Component({
  selector: 'app-variant-detail-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    TextareaModule,
    ConfirmDialogModule,
    MoneyPipe,
    UnitQuantityPipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './variant-detail-page.component.html',
  styles: [
    `
      .page-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 1rem;
        margin-bottom: 1.5rem;
        padding: 1rem 1.25rem;
        background: #131313;
        border: 1px solid #1f1f1f;
        border-radius: 4px;
      }
      .meta-grid > div {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .meta-grid label {
        font-size: 0.7rem;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      }
      .meta-grid strong {
        font-size: 1.15rem;
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-variant-numeric: tabular-nums;
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
      .section {
        margin: 2rem 0 1rem;
      }
      .section h2 {
        font-size: 0.85rem;
        margin: 0 0 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #888;
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-weight: 600;
      }
      .build-notes-card {
        border: 1px solid #1f1f1f;
        border-radius: 4px;
        background: #131313;
        padding: 0.75rem;
      }
      .build-notes-textarea {
        width: 100%;
        min-height: 180px;
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
        font-size: 0.85rem;
        line-height: 1.45;
        white-space: pre-wrap;
        padding: 0.6rem 0.75rem;
        border: 1px solid #1f1f1f;
        border-radius: 4px;
        resize: vertical;
        background: #0f0f0f;
        color: #f5f5f5;
      }
      .build-notes-textarea:focus {
        outline: none;
        border-color: #84cc16;
      }
      .build-actions {
        margin-top: 0.6rem;
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .attachments-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }
      .file-input {
        display: none;
      }
      .attachments-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 0.75rem;
      }
      .attachment-card {
        border: 1px solid #1f1f1f;
        border-radius: 4px;
        background: #131313;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .attachment-thumb {
        background: #0f0f0f;
        aspect-ratio: 4 / 3;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        overflow: hidden;
      }
      .attachment-thumb img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .attachment-thumb .pi {
        font-size: 2.5rem;
        color: #888;
      }
      .attachment-meta {
        padding: 0.4rem 0.6rem;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        font-size: 0.78rem;
      }
      .attachment-name {
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .attachment-sub {
        color: #888;
        font-size: 0.72rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .preview-img {
        max-width: 100%;
        max-height: 70vh;
        display: block;
        margin: 0 auto;
      }
    `,
  ],
})
export class VariantDetailPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly messageService = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  readonly variant = signal<Variant | null>(null);
  readonly recipeRows = signal<RecipeRow[]>([]);
  readonly availableComponents = signal<ComponentRow[]>([]);
  readonly attachments = signal<Attachment[]>([]);
  readonly loading = signal(false);
  readonly uploading = signal(false);

  readonly buildNotesDraft = signal<string>('');
  readonly buildNotesDirty = signal(false);

  readonly previewAttachment = signal<Attachment | null>(null);

  readonly componentOptions = computed(() =>
    this.availableComponents().map((c) => {
      const parens = [c.colour, c.size, c.unit].filter((x) => x && String(x).trim()).join(', ');
      return {
        label: parens ? `${c.name} (${parens})` : c.name,
        value: c.id,
      };
    })
  );

  readonly recipeOpen = signal(false);
  readonly recipeForm = signal<RecipeForm | null>(null);

  readonly margin = computed(() => {
    const v = this.variant();
    if (!v || v.unit_cost_pence == null || !v.price_pence) return null;
    return ((v.price_pence - v.unit_cost_pence) / v.price_pence) * 100;
  });

  async ngOnInit(): Promise<void> {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isFinite(id)) return;
    await this.refresh(id);
  }

  async refresh(id: number = this.variant()?.id ?? 0): Promise<void> {
    this.loading.set(true);
    try {
      const [variant, rows, components, attachments] = await Promise.all([
        trpc.products.getVariant.query({ id }),
        trpc.recipes.list.query({ variantId: id }),
        trpc.components.list.query(),
        trpc.attachments.list.query({ variantId: id }),
      ]);
      this.variant.set(variant);
      this.recipeRows.set(rows);
      this.availableComponents.set(components);
      this.attachments.set(attachments);
      this.buildNotesDraft.set(variant.build_notes ?? '');
      this.buildNotesDirty.set(false);
    } finally {
      this.loading.set(false);
    }
  }

  // ------ Build notes ------
  onBuildNotesChange(value: string): void {
    this.buildNotesDraft.set(value);
    this.buildNotesDirty.set(value !== (this.variant()?.build_notes ?? ''));
  }

  async saveBuildNotes(): Promise<void> {
    const variant = this.variant();
    if (!variant) return;
    try {
      const next = this.buildNotesDraft().trim() || null;
      await trpc.products.updateBuildNotes.mutate({ id: variant.id, buildNotes: next });
      this.messageService.add({ severity: 'success', summary: 'Build notes saved', life: 1800 });
      this.buildNotesDirty.set(false);
      await this.refresh(variant.id);
    } catch (err) {
      this.fail(err);
    }
  }

  resetBuildNotes(): void {
    this.buildNotesDraft.set(this.variant()?.build_notes ?? '');
    this.buildNotesDirty.set(false);
  }

  // ------ Attachments ------
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const variant = this.variant();
    if (!variant || !input.files?.length) return;

    this.uploading.set(true);
    try {
      for (const file of Array.from(input.files)) {
        const buffer = await file.arrayBuffer();
        await trpc.attachments.add.mutate({
          variantId: variant.id,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          data: new Uint8Array(buffer),
        });
      }
      this.messageService.add({
        severity: 'success',
        summary:
          input.files.length === 1
            ? `Uploaded ${input.files[0].name}`
            : `Uploaded ${input.files.length} files`,
        life: 2500,
      });
      await this.refresh(variant.id);
    } catch (err) {
      this.fail(err);
    } finally {
      this.uploading.set(false);
      input.value = ''; // allow re-selecting the same file
    }
  }

  imageUrl(a: Attachment): string {
    // Electron uses the craft-asset:// protocol; browser/iPhone uses
    // /assets/* served by the HTTP server in main.
    return assetUrl(a.storage_path);
  }

  isImage(a: Attachment): boolean {
    return a.mime_type.startsWith('image/');
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  openPreview(a: Attachment): void {
    this.previewAttachment.set(a);
  }

  closePreview(): void {
    this.previewAttachment.set(null);
  }

  deleteAttachment(a: Attachment): void {
    this.confirmation.confirm({
      message: `Delete attachment "${a.filename}"?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      accept: async () => {
        try {
          await trpc.attachments.remove.mutate({ id: a.id });
          this.messageService.add({ severity: 'success', summary: 'Deleted', life: 1800 });
          const v = this.variant();
          if (v) await this.refresh(v.id);
        } catch (err) {
          this.fail(err);
        }
      },
    });
  }

  openAddRow(): void {
    this.recipeForm.set({
      recipeId: null,
      componentId: null,
      componentName: '',
      componentUnit: '',
      quantityPerUnit: null,
      costPoolPencePerUnit: null,
      notes: '',
    });
    this.recipeOpen.set(true);
  }

  openEditRow(row: RecipeRow): void {
    this.recipeForm.set({
      recipeId: row.id,
      componentId: row.componentId,
      componentName: row.componentName,
      componentUnit: row.componentUnit,
      quantityPerUnit: row.quantityPerUnit,
      costPoolPencePerUnit: row.costPoolPencePerUnit,
      notes: row.notes ?? '',
    });
    this.recipeOpen.set(true);
  }

  onComponentChange(): void {
    const f = this.recipeForm();
    if (!f || f.componentId == null) return;
    const comp = this.availableComponents().find((c) => c.id === f.componentId);
    if (!comp) return;
    this.recipeForm.set({
      ...f,
      componentName: comp.name,
      componentUnit: comp.unit,
      quantityPerUnit: comp.unit === 'cost_pool' ? null : (f.quantityPerUnit ?? null),
      costPoolPencePerUnit: comp.unit === 'cost_pool' ? (f.costPoolPencePerUnit ?? null) : null,
    });
  }

  async submitRecipe(): Promise<void> {
    const f = this.recipeForm();
    const variant = this.variant();
    if (!f || !variant) return;
    if (f.componentId == null) {
      this.messageService.add({ severity: 'warn', summary: 'Pick a component', life: 2500 });
      return;
    }
    try {
      await trpc.recipes.upsert.mutate({
        variantId: variant.id,
        componentId: f.componentId,
        quantityPerUnit: f.componentUnit === 'cost_pool' ? null : f.quantityPerUnit,
        costPoolPencePerUnit: f.componentUnit === 'cost_pool' ? f.costPoolPencePerUnit : null,
        notes: f.notes.trim() || null,
      });
      this.recipeOpen.set(false);
      this.messageService.add({ severity: 'success', summary: 'Recipe updated', life: 2000 });
      await this.refresh(variant.id);
    } catch (err) {
      this.fail(err);
    }
  }

  deleteRow(row: RecipeRow): void {
    this.confirmation.confirm({
      message: `Remove ${row.componentName} from this recipe?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      accept: async () => {
        try {
          await trpc.recipes.remove.mutate({ recipeId: row.id });
          this.messageService.add({ severity: 'success', summary: 'Removed', life: 2000 });
          const variant = this.variant();
          if (variant) await this.refresh(variant.id);
        } catch (err) {
          this.fail(err);
        }
      },
    });
  }

  rowCostPence(row: RecipeRow): number | null {
    if (row.componentUnit === 'cost_pool') return row.costPoolPencePerUnit;
    if (row.quantityPerUnit == null || row.componentCostPerUnitPence == null) return null;
    return Math.round(row.quantityPerUnit * row.componentCostPerUnitPence);
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
