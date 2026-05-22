# Gyümölcsnaptár – értesítési rendszer Supabase deploy
# Előfeltétel: Supabase projekt UNPAUSED (Dashboard → Restore project)
# Használat: .\scripts\deploy-notifications.ps1 -ProjectRef dxqweukbtuckvrdvlcjd

param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRef,

    [string]$EnvFile = ".env.local"
)

$ErrorActionPreference = "Stop"

function Get-EnvValue([string]$Name) {
    if (-not (Test-Path $EnvFile)) {
        throw "Missing $EnvFile"
    }
    $line = Get-Content $EnvFile | Where-Object { $_ -match "^\s*$Name=" } | Select-Object -First 1
    if (-not $line) {
        throw "Missing $Name in $EnvFile"
    }
    return ($line -split "=", 2)[1].Trim()
}

Write-Host "Linking Supabase project $ProjectRef ..."
npx supabase link --project-ref $ProjectRef

Write-Host "Pushing DB migrations ..."
npx supabase db push

Write-Host "Deploying Edge Functions ..."
npx supabase functions deploy keycloak-gateway --no-verify-jwt
npx supabase functions deploy daily-fruit-reminder --no-verify-jwt

Write-Host "Setting notification secrets ..."
$secrets = @(
    "VAPID_PUBLIC_KEY=$(Get-EnvValue 'VAPID_PUBLIC_KEY')",
    "VAPID_PRIVATE_KEY=$(Get-EnvValue 'VAPID_PRIVATE_KEY')",
    "VAPID_SUBJECT=$(Get-EnvValue 'VAPID_SUBJECT')",
    "CRON_SECRET=$(Get-EnvValue 'CRON_SECRET')",
    "RESEND_FROM_EMAIL=$(Get-EnvValue 'RESEND_FROM_EMAIL')"
)

$resendKey = Get-EnvValue 'RESEND_API_KEY'
if ($resendKey -notmatch '^re_xxxxxxxx') {
    $secrets += "RESEND_API_KEY=$resendKey"
} else {
    Write-Warning "RESEND_API_KEY is still a placeholder – skip or set in $EnvFile first."
}

npx supabase secrets set @secrets

Write-Host ""
Write-Host "Done. Manual steps remaining:"
Write-Host "  1. Supabase Dashboard -> Edge Functions -> daily-fruit-reminder -> Schedules -> 0 5 * * *"
Write-Host "  2. Resend.com: domain verify + real RESEND_API_KEY in secrets if skipped"
Write-Host "  3. Test: swap notification + push subscribe on next.gyuminaptar.hu"
