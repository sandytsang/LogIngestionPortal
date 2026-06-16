import { describe, expect, it } from 'vitest';
import { columnsFromSample, inferType } from '../src/lib/sampleToColumns';

describe('inferType', () => {
  it('maps primitives and shapes to column types', () => {
    expect(inferType(true)).toBe('boolean');
    expect(inferType(42)).toBe('int');
    expect(inferType(5000000000)).toBe('long');
    expect(inferType(1.5)).toBe('real');
    expect(inferType('hello')).toBe('string');
    expect(inferType('2026-06-16T12:00:00Z')).toBe('datetime');
    expect(inferType('550e8400-e29b-41d4-a716-446655440000')).toBe('guid');
    expect(inferType({ a: 1 })).toBe('dynamic');
    expect(inferType([1, 2])).toBe('dynamic');
    expect(inferType(null)).toBe('string');
  });
});

describe('columnsFromSample', () => {
  it('builds a columns document with TimeGenerated + inferred columns', () => {
    const doc = columnsFromSample(
      '{"DeviceName":"PC-01","FreeDiskGB":123.4,"IsCompliant":true,"LastSeen":"2026-06-16T12:00:00Z"}',
      'MyTable_CL',
      'desc',
    );
    expect(doc.tables).toHaveLength(1);
    const table = doc.tables[0];
    expect(table.tableName).toBe('MyTable_CL');
    expect(table.columns[0]).toMatchObject({ name: 'TimeGenerated', type: 'datetime' });
    const byName = Object.fromEntries(table.columns.map((c) => [c.name, c.type]));
    expect(byName.DeviceName).toBe('string');
    expect(byName.FreeDiskGB).toBe('real');
    expect(byName.IsCompliant).toBe('boolean');
    expect(byName.LastSeen).toBe('datetime');
  });

  it('accepts an array and uses the first record', () => {
    const doc = columnsFromSample('[{"A":1}]', 'T_CL', 'd');
    expect(doc.tables[0].columns.some((c) => c.name === 'A' && c.type === 'int')).toBe(true);
  });

  it('builds one table per key for a table-keyed sample', () => {
    const doc = columnsFromSample(
      '{"Table1_CL":[{"A":1}],"Table2_CL":[{"B":"x"}]}',
      'Ignored_CL',
      'd',
    );
    expect(doc.tables.map((t) => t.tableName)).toEqual(['Table1_CL', 'Table2_CL']);
    expect(doc.tables[0].columns.some((c) => c.name === 'A')).toBe(true);
    expect(doc.tables[1].columns.some((c) => c.name === 'B')).toBe(true);
  });

  it('rejects invalid JSON', () => {
    expect(() => columnsFromSample('{not json', 'T_CL', 'd')).toThrow(/valid JSON/);
  });

  it('rejects invalid column names', () => {
    expect(() => columnsFromSample('{"bad name":1}', 'T_CL', 'd')).toThrow(/valid column name/);
  });
});
