import { useMemo, useState } from 'react';
import { columnsFromSample } from '../lib/sampleToColumns';
import { columnsToJson } from '../lib/generators';
import { copyText, downloadText } from '../lib/browser';

interface Props {
  tableName: string;
  tableDescription: string;
  onClose: () => void;
}

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900';

export function SampleColumnsDialog({ tableName, tableDescription, onClose }: Props) {
  const [sample, setSample] = useState('');
  const [name, setName] = useState(tableName);
  const [desc, setDesc] = useState(tableDescription);
  const [copied, setCopied] = useState(false);

  const nameError =
    name.trim() && !/_CL$/.test(name.trim()) ? 'Custom table name must end with _CL.' : '';

  const result = useMemo(() => {
    const trimmed = sample.trim();
    if (!trimmed) return { json: '', error: '' };
    if (!name.trim()) return { json: '', error: 'Enter a table name.' };
    if (nameError) return { json: '', error: nameError };
    try {
      const doc = columnsFromSample(trimmed, name.trim(), desc.trim());
      return { json: columnsToJson(doc), error: '' };
    } catch (e) {
      return { json: '', error: e instanceof Error ? e.message : 'Could not parse the sample.' };
    }
  }, [sample, name, desc, nameError]);

  const onCopy = async () => {
    if (await copyText(result.json)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold">Build columns.json from sample data</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Paste the JSON from <code>IntuneScript.ps1 -PreviewData</code> to generate a matching schema.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
            Run your edited script as SYSTEM to capture the body it would send:
            <br />
            <code>psexec -s -i powershell.exe -File .\IntuneScript.ps1 -PreviewData</code>
            <br />
            Paste that JSON below. Column types are inferred (string, int, real, boolean,
            datetime, guid, or dynamic for objects/arrays). TimeGenerated is always added.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="s-tablename">
                Table name
              </label>
              <input
                id="s-tablename"
                className={`${input} mt-1`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Devices_CL"
              />
              {nameError && <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{nameError}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="s-tabledesc">
                Table description
              </label>
              <input
                id="s-tabledesc"
                className={`${input} mt-1`}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="What this table stores."
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="sample">
              Sample data JSON
            </label>
            <textarea
              id="sample"
              rows={8}
              className={`${input} mt-1 font-mono text-xs`}
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              placeholder={'{\n  "DeviceName": "PC-01",\n  "FreeDiskGB": 123.4,\n  "IsCompliant": true,\n  "LastSeen": "2026-06-16T12:00:00Z"\n}'}
            />
          </div>

          {result.error ? (
            <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
              {result.error}
            </p>
          ) : result.json ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  ✓ Generated columns.json
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={onCopy}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => downloadText('columns.json', result.json)}
                    className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                  >
                    Download columns.json
                  </button>
                </div>
              </div>
              <pre className="scroll-thin max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                <code>{result.json}</code>
              </pre>
              <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                Review the inferred types before deploying — adjust any that should differ
                (e.g. a numeric string you want kept as <code>string</code>). Then redeploy
                with <code>deploy.ps1</code> (or the schema-only update) to apply the table.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
