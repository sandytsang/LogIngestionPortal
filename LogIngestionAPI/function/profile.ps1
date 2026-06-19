# Azure Functions profile.ps1
#
# Author : Sandy Zeng
#
# Version history:
#   1.0.0 (2026-06-19) Initial documented release; added author and version
#                      history header.
#   1.0.1 (2026-06-19) Reviewed with PSScriptAnalyzer for cmdlet aliases and
#                      approved verbs; no alias issues found.
#
# This profile runs on every cold start of the PowerShell worker process.
# We intentionally do NOT import the Az modules: tokens for the Logs Ingestion
# API are obtained directly from the managed identity endpoint inside run.ps1,
# which keeps cold starts fast and dependencies minimal.
