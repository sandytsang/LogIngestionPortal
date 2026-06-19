# Manual Permission Fallback Runbook

Operator runbook for when `deploy.ps1` or `deploy.yml` cannot assign one or both required permissions automatically.

Use this when deployment logs show warnings such as:

- missing **Monitoring Metrics Publisher** on the DCR resource group
- missing Graph **Device.Read.All** for the Function managed identity

---

## Scope

This runbook covers two manual grants:

1. Azure RBAC role assignment: **Monitoring Metrics Publisher**
2. Microsoft Graph app-role assignment: **Device.Read.All**

Both grants target the Function App's **system-assigned managed identity**.

## Required roles

| Task | Minimum role |
|------|--------------|
| Assign Monitoring Metrics Publisher | Owner, User Access Administrator, or RBAC Administrator on the DCR resource group |
| Assign Graph Device.Read.All | Privileged Role Administrator or Global Administrator in Entra |

If one person does not hold both sets of rights, split this runbook between Azure RBAC admin and Entra admin.

## Inputs checklist

Collect these values first:

- `<subscription-id>`
- `<function-resource-group>`
- `<function-app-name>`
- `<dcr-resource-group>`

Resolve the Function managed identity object id:

```bash
az account set --subscription <subscription-id>
MI_OBJECT_ID=$(az functionapp identity show \
  -g <function-resource-group> \
  -n <function-app-name> \
  --query principalId -o tsv)
echo "$MI_OBJECT_ID"
```

If `MI_OBJECT_ID` is empty, enable identity first:

```bash
az functionapp identity assign -g <function-resource-group> -n <function-app-name>
```

## Step 1 - Grant Monitoring Metrics Publisher

```bash
az role assignment create \
  --assignee-object-id "$MI_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Monitoring Metrics Publisher" \
  --scope "/subscriptions/<subscription-id>/resourceGroups/<dcr-resource-group>"
```

Verify:

```bash
ROLE_ID="3913510d-42f4-4e42-8a64-420c390055eb"
az role assignment list \
  --assignee-object-id "$MI_OBJECT_ID" \
  --scope "/subscriptions/<subscription-id>/resourceGroups/<dcr-resource-group>" \
  --query "[?roleDefinitionId=='/subscriptions/<subscription-id>/providers/Microsoft.Authorization/roleDefinitions/$ROLE_ID'].id" \
  -o tsv
```

Expected: a non-empty id.

## Step 2 - Grant Graph Device.Read.All

Required only when `JWT_REQUIRE_ENTRA_DEVICE=true` (default).

```bash
GRAPH_SP_ID=$(az ad sp list \
  --filter "appId eq '00000003-0000-0000-c000-000000000000'" \
  --query '[0].id' -o tsv)
GRAPH_DEVICE_READ_ALL_ROLE_ID="7438b122-aefc-4978-80ed-43db9fcc7715"

az rest --method POST \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$MI_OBJECT_ID/appRoleAssignments" \
  --headers 'Content-Type=application/json' \
  --body "{\"principalId\":\"$MI_OBJECT_ID\",\"resourceId\":\"$GRAPH_SP_ID\",\"appRoleId\":\"$GRAPH_DEVICE_READ_ALL_ROLE_ID\"}"
```

Verify:

```bash
az rest --method GET \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$MI_OBJECT_ID/appRoleAssignments" \
  --query "value[?appRoleId=='7438b122-aefc-4978-80ed-43db9fcc7715'] | [0].id" \
  -o tsv
```

Expected: a non-empty id.

## Step 3 - Propagation wait and health check

- Wait 2-10 minutes for permission propagation.
- Re-run your deployment workflow or send one device telemetry request.

Expected runtime outcome:

- no `401` caused by `Directory lookup failed`
- no `403` from DCR ingestion due to missing role assignment

## Failure mapping

| Symptom | Likely issue |
|--------|---------------|
| `401` with auth failures after deploy | Graph Device.Read.All missing or not propagated |
| `403` from ingestion endpoint | Monitoring Metrics Publisher missing on DCR RG |
| `Insufficient privileges` while assigning Graph role | Caller lacks Entra admin role |
| `AuthorizationFailed` while assigning RBAC role | Caller lacks RBAC assignment rights |

## Escalation package

When escalating to platform/security admins, include:

1. Subscription id and tenant id
2. Function app name and resource group
3. DCR resource group
4. Managed identity object id
5. Exact failing command output
