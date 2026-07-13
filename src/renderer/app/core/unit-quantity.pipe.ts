import { Pipe, PipeTransform } from '@angular/core';
import type { Unit } from '../../../shared/units';

// Format a stock quantity with its unit. e.g. 1234 mm -> "1,234 mm"; cost_pool
// shows a dash because quantity is meaningless.
@Pipe({ name: 'unitQty', standalone: true, pure: true })
export class UnitQuantityPipe implements PipeTransform {
  transform(value: number | null | undefined, unit: Unit | string): string {
    if (unit === 'cost_pool') return '—';
    if (value == null || Number.isNaN(value)) return '—';
    const formatted = value.toLocaleString('en-GB', { maximumFractionDigits: 3 });
    if (unit === 'each') return formatted;
    return `${formatted} ${unit}`;
  }
}
