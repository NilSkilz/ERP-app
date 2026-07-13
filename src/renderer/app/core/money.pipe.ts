import { Pipe, PipeTransform } from '@angular/core';

// Pence -> "£1.49". Pence are always integer at the boundary; format here only.
@Pipe({ name: 'money', standalone: true, pure: true })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, withSymbol = true): string {
    if (value == null || Number.isNaN(value)) return '—';
    const pounds = value / 100;
    const formatted = pounds.toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return withSymbol ? `£${formatted}` : formatted;
  }
}
