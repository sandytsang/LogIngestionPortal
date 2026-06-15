import { describe, expect, it } from 'vitest';
import { scanForbidden } from '../src/lib/security';
import { deriveId, draftToFieldJson, emptyDraft, validateDraft } from '../src/lib/contribution';

describe('scanForbidden', () => {
  it('passes a read-only collector', () => {
    expect(scanForbidden('(Get-CimInstance Win32_BIOS).SerialNumber')).toEqual([]);
  });

  it('flags code execution and downloads', () => {
    expect(scanForbidden('Invoke-Expression $x').length).toBeGreaterThan(0);
    expect(scanForbidden('Invoke-WebRequest http://x').length).toBeGreaterThan(0);
    expect(scanForbidden('Remove-Item C:\\temp').length).toBeGreaterThan(0);
  });
});

describe('contribution drafts', () => {
  it('derives a PowerShell-safe id', () => {
    expect(deriveId('Chassis_Type 1')).toBe('ChassisType1');
    expect(deriveId('123abc')).toBe('Field123abc');
  });

  it('rejects an incomplete or unsafe draft', () => {
    expect(validateDraft(emptyDraft).length).toBeGreaterThan(0);
    expect(
      validateDraft({
        ...emptyDraft,
        category: 'Hardware',
        label: 'X',
        columnName: 'X',
        description: 'd',
        collector: 'Remove-Item C:\\x',
      }).some((e) => e.includes('read-only')),
    ).toBe(true);
  });

  it('produces valid field JSON for a clean draft', () => {
    const json = draftToFieldJson({
      ...emptyDraft,
      category: 'Hardware',
      label: 'Chassis type',
      columnName: 'ChassisType',
      description: 'Chassis code.',
      collector: '(Get-CimInstance Win32_SystemEnclosure).ChassisTypes -join ","',
      needsSystem: true,
    });
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe('ChassisType');
    expect(parsed.column.name).toBe('ChassisType');
    expect(parsed.needsSystem).toBe(true);
    expect(parsed.order).toBe(100);
  });
});
