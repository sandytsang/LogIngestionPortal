# Azure Functions profile.ps1
#
# This profile runs on every cold start of the PowerShell worker process.
# We intentionally do NOT import the Az modules: tokens for the Logs Ingestion
# API are obtained directly from the managed identity endpoint inside run.ps1,
# which keeps cold starts fast and dependencies minimal.
