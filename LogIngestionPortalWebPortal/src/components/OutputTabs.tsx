import { useState } from 'react';
import { copyText, downloadText } from '../lib/browser';

export interface OutputTab {
  id: string;
  label: string;
  filename: string;
  language: string;
  content: string;
}

interface Props {
  tabs: OutputTab[];
}

export function OutputTabs({ tabs }: Props) {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const [copied, setCopied] = useState(false);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  if (!current) return null;

  const onCopy = async () => {
    const ok = await copyText(current.content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`rounded-t-lg px-3 py-2 text-xs font-medium transition ${
                t.id === current.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pb-1">
          <button
            onClick={onCopy}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={() => downloadText(current.filename, current.content)}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Download
          </button>
        </div>
      </div>
      <pre className="scroll-thin min-h-0 flex-1 overflow-auto rounded-b-lg border border-slate-200 bg-slate-50 p-4 text-[12px] leading-relaxed text-slate-800">
        <code>{current.content}</code>
      </pre>
      <p className="mt-1 text-[11px] text-slate-400">
        {current.filename} · {current.language}
      </p>
    </div>
  );
}
