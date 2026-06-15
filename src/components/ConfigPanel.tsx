import type { PortalConfig } from '../types';

interface Props {
  config: PortalConfig;
  onChange: (patch: Partial<PortalConfig>) => void;
  workspaceName: string;
  onWorkspaceChange: (value: string) => void;
  errors: string[];
}

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900';
const label = 'block text-xs font-medium text-slate-600 dark:text-slate-300';

export function ConfigPanel({ config, onChange, workspaceName, onWorkspaceChange, errors }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <label className={label} htmlFor="functionUrl">
          Function URL <span className="text-slate-400">(includes ?code=…)</span>
        </label>
        <input
          id="functionUrl"
          className={`${field} mt-1`}
          value={config.functionUrl}
          onChange={(e) => onChange({ functionUrl: e.target.value })}
          placeholder="https://<app>.azurewebsites.net/api/Ingest?code=<key>"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="tableName">
            Table name
          </label>
          <input
            id="tableName"
            className={`${field} mt-1`}
            value={config.tableName}
            onChange={(e) => onChange({ tableName: e.target.value })}
          />
        </div>
        <div>
          <label className={label} htmlFor="remediationName">
            Remediation name
          </label>
          <input
            id="remediationName"
            className={`${field} mt-1`}
            value={config.remediationName}
            onChange={(e) => onChange({ remediationName: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="tableDescription">
          Table description
        </label>
        <input
          id="tableDescription"
          className={`${field} mt-1`}
          value={config.tableDescription}
          onChange={(e) => onChange({ tableDescription: e.target.value })}
        />
      </div>

      <div>
        <label className={label} htmlFor="workspaceName">
          Existing workspace name <span className="text-slate-400">(optional)</span>
        </label>
        <input
          id="workspaceName"
          className={`${field} mt-1`}
          value={workspaceName}
          onChange={(e) => onWorkspaceChange(e.target.value)}
          placeholder="leave empty to create a new workspace"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          className="h-4 w-4 accent-indigo-600"
          checked={config.useJwt}
          onChange={(e) => onChange({ useJwt: e.target.checked })}
        />
        Use device-signed JWT authentication
      </label>

      {errors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
