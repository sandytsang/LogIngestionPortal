import { ALLOWED_COLUMN_TYPES, type ColumnType } from '../types';
import { scanForbidden } from './security';

const REPO = 'sandytsang/LogIngestionPortal';

export interface FieldDraft {
  category: string;
  label: string;
  columnName: string;
  columnType: ColumnType;
  description: string;
  collector: string;
}

export const emptyDraft: FieldDraft = {
  category: '',
  label: '',
  columnName: '',
  columnType: 'string',
  description: '',
  collector: '',
};

/** Derives a PowerShell-safe field id (letters/numbers, starts with a letter). */
export function deriveId(columnName: string): string {
  const cleaned = columnName.replace(/[^A-Za-z0-9]/g, '');
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `Field${cleaned}`;
}

/** Validates a draft the same way CI will (shape + read-only security gate). */
export function validateDraft(draft: FieldDraft): string[] {
  const errors: string[] = [];
  if (!draft.category.trim()) errors.push('Category is required.');
  if (!draft.label.trim()) errors.push('Label is required.');
  if (!draft.columnName.trim()) {
    errors.push('Column name is required.');
  } else if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(draft.columnName)) {
    errors.push('Column name must start with a letter and contain only letters, numbers, or underscores.');
  }
  if (!ALLOWED_COLUMN_TYPES.includes(draft.columnType)) {
    errors.push(`Column type must be one of: ${ALLOWED_COLUMN_TYPES.join(', ')}.`);
  }
  if (!draft.description.trim()) errors.push('Description is required.');
  if (!draft.collector.trim()) {
    errors.push('Collector is required.');
  } else {
    for (const why of scanForbidden(draft.collector)) {
      errors.push(`Collector is rejected: ${why}. Collectors must be read-only.`);
    }
  }
  return errors;
}

/** Builds the field JSON object a contributor pastes into a category file. */
export function draftToFieldJson(draft: FieldDraft): string {
  const field: Record<string, unknown> = {
    id: deriveId(draft.columnName),
    label: draft.label.trim(),
    order: 100,
    default: false,
    setups: [],
    collector: draft.collector.replace(/\r\n/g, '\n').trim(),
    column: {
      name: draft.columnName.trim(),
      type: draft.columnType,
      description: draft.description.trim(),
    },
  };
  return JSON.stringify(field, null, 2);
}

/** Builds a full new-category file (used when proposing a brand-new category). */
export function draftToCategoryFile(draft: FieldDraft): string {
  return JSON.stringify(
    { category: draft.category.trim(), fields: [JSON.parse(draftToFieldJson(draft))] },
    null,
    2,
  ) + '\n';
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'new-category';
}

/**
 * Deep-link that opens GitHub's "create new file" page pre-filled with a new
 * category file. If the category already exists the contributor instead pastes
 * the field JSON into that file — the dialog explains both paths.
 */
export function newCategoryPrUrl(draft: FieldDraft): string {
  const filename = `catalog/categories/${slug(draft.category)}.json`;
  const value = encodeURIComponent(draftToCategoryFile(draft));
  return `https://github.com/${REPO}/new/main?filename=${encodeURIComponent(filename)}&value=${value}`;
}

/** Link to open the existing category folder on GitHub. */
export function categoriesFolderUrl(): string {
  return `https://github.com/${REPO}/tree/main/catalog/categories`;
}
