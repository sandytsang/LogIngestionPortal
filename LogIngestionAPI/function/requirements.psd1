# Azure Functions requirements.psd1 - PowerShell worker module dependencies.
#
# Author : Sandy Zeng
#
# Version history:
#   1.0.0 (2026-06-19) Initial documented release; added author and version
#                      history header.
#
# No managed dependencies are required. Tokens are acquired directly from the
# managed identity endpoint via REST, so the Az modules are not imported.
@{
}
