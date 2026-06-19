/**
 * Collapsible "How to deploy" panel shown on the page so users see the main ways
 * to deploy the downloaded zip without leaving the portal. The per-selection,
 * copy-pasteable command lives in the generated README.txt tab; this panel is
 * the higher-level "which method and what order" overview.
 */
export function DeployHelp() {
  return (
    <details open className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <summary className="flex cursor-pointer select-none items-center gap-2 text-base font-bold tracking-tight text-slate-800 dark:text-slate-100">
        <span className="h-4 w-1 rounded bg-accent" />
        Step 5: Read the instruction
      </summary>

      <div className="mt-3 space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        <p>
          Click <span className="font-semibold">Download all (.zip)</span> above. The zip is the
          complete <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">LogIngestionAPI</code>{' '}
          backend with your <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">columns.json</code>{' '}
          and Intune script already in place. Unzip it and pick one of the methods below — the
          exact command for your selection is in the <span className="font-semibold">README.txt</span> tab.
        </p>

        {/* Method 1 — local PowerShell */}
        <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Option A — Run the script locally (deploy.ps1)
          </h3>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Easiest for a one-off deploy from your own machine.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Install <span className="font-semibold">PowerShell 7+</span>, the{' '}
              <span className="font-semibold">Azure CLI</span>, and the{' '}
              <span className="font-semibold">Azure Functions Core Tools</span>.
            </li>
            <li>
              Sign in: <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">az login</code>
            </li>
            <li>
              Open a terminal in the unzipped{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">LogIngestionAPI</code>{' '}
              folder and run the command from the{' '}
              <span className="font-semibold">README.txt</span> tab (it already has your resource
              group, region, and options filled in).
            </li>
            <li>
              Follow the script's final notes: grant the Function its Graph permission and wire the
              printed Function URL into your Intune script.
            </li>
          </ol>
        </section>

        {/* Method 2 — Azure Cloud Shell */}
        <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Option B — Run in Azure Cloud Shell (no local installs)
          </h3>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Best when your machine cannot install PowerShell/CLI tools.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Open{' '}
              <a
                href="https://shell.azure.com"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-accent underline"
              >
                shell.azure.com
              </a>
              {' '}and sign in.
            </li>
            <li>
              Upload your generated{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">columns.json</code>{' '}
              file (Cloud Shell usually stores uploads under{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">/home/&lt;your-user&gt;/</code>).
            </li>
            <li>
              Clone this repo (or upload/unzip the generated{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">LogIngestionAPI</code>{' '}
              folder) and run the Cloud Shell command from the{' '}
              <span className="font-semibold">README.txt</span> tab.
              <div className="mt-2 rounded-lg bg-slate-100 p-2 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <div>cd ~</div>
                <div>rm -rf LogIngestionPortal</div>
                <div>git clone https://github.com/sandytsang/LogIngestionPortal.git</div>
                <div>cd LogIngestionPortal</div>
              </div>
            </li>
            <li>
              Keep{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">-SchemaPath /home/&lt;your-user&gt;/columns.json</code>{' '}
              and{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">-Subscription &lt;subscription-name-or-id&gt;</code>{' '}
              as shown in README.txt so deployment uses the right file and subscription.
            </li>
          </ol>
        </section>

        {/* Method 3 — GitHub Actions */}
        <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Option C — Deploy from your own GitHub (Actions)
          </h3>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Best if you want a repeatable, button-click deploy with no local tools.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Create a new repo in your GitHub org and push the unzipped{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">LogIngestionAPI</code>{' '}
              folder as the repo root (the bundled{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">.github/workflows</code>{' '}
              come with it).
            </li>
            <li>
              Add an Entra app with an OIDC federated credential and set the repo secrets{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">AZURE_CLIENT_ID</code>,{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">AZURE_TENANT_ID</code>,{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">AZURE_SUBSCRIPTION_ID</code>.
            </li>
            <li>
              Open <span className="font-semibold">Actions → Run workflow</span> on either{' '}
              <span className="font-semibold">Deploy LogIngestionAPI</span> for the full stack or{' '}
              <span className="font-semibold">Update data columns (schema-only)</span> for a
              table + DCR refresh. The workflows use the native Bicep path only.
            </li>
            <li>
              Full setup details (roles, federated-credential subject, prod approval gate) are in the
              bundled{' '}
              <a
                href="https://github.com/sandytsang/LogIngestionPortal/blob/main/LogIngestionAPI/README.md"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-accent underline"
              >
                README.md
              </a>
              .
            </li>
          </ol>
        </section>

        <p className="text-slate-500 dark:text-slate-400">
          Either way, the first request from a device only succeeds after the Function App's managed
          identity has Microsoft Graph <span className="font-semibold">Device.Read.All</span> — the
          workflow checks it and warns if a Graph admin still needs to grant it manually.
        </p>

        <p className="text-slate-500 dark:text-slate-400">
          The Function identity also needs <span className="font-semibold">Monitoring Metrics Publisher</span>{' '}
          on the <span className="font-semibold">resource group that contains the DCR</span>. Assign this role
          on that resource-group scope (not on the DCR resource itself) if the workflow warns it is missing.
        </p>
      </div>
    </details>
  );
}
