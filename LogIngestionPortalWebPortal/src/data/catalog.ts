import type { Catalog, CatalogField } from '../types';
import meta from '../../catalog/meta.json';
import setups from '../../catalog/setups.json';

interface CategoryFile {
  category: string;
  fields: Omit<CatalogField, 'category'>[];
}

// ---------------------------------------------------------------------------
// The catalog is assembled at build time from the data files under /catalog so
// that new categories and properties can be contributed as plain JSON (see
// CONTRIBUTING.md). Each field bundles its Log Analytics column AND the
// PowerShell that collects it, keeping the schema and the device script in sync.
//
// Fields are sorted by their explicit `order`, which also fixes the column order
// in the generated columns.json (orders 1-15 reproduce the original schema).
// ---------------------------------------------------------------------------
const categoryFiles = import.meta.glob<CategoryFile>('../../catalog/categories/*.json', {
  eager: true,
  import: 'default',
});

const fields: CatalogField[] = Object.values(categoryFiles)
  .flatMap((file) => file.fields.map((f) => ({ ...f, category: file.category })))
  .sort((a, b) => a.order - b.order);

export const catalog: Catalog = {
  tableName: meta.tableName,
  description: meta.description,
  setups: setups as Record<string, string>,
  setupOrder: meta.setupOrder,
  fields,
};
