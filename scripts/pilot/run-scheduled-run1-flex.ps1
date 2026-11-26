<#
.SYNOPSIS
One-shot scheduled runner for Stage 1 blind scoring Run 1 (P0 58 + 18 anchors, Flex tier).
Scheduled for 2026-11-26 02:30 JST on CHIBA-PC.

Rules enforced:
- Does NOT embed or log GEMINI_API_KEY (run-api-url-batch.mjs loads E:\iketeru-eizou\.env internally).
- Does NOT run git commit or git push.
- Does NOT write to TiDB or production SQLite.
- Keeps the PC awake during execution via Win32 SetThreadExecutionState.
- Logs output to E:\iketeru_api_url_logs\run1_p0_20261126_023000\scheduled_task.log.
#>

$ErrorActionPreference = "Continue"
$repoRoot = "E:\iketeru-eizou"
$runId = "run1_p0_20261126_023000"
$logDir = "E:\iketeru_api_url_logs\$runId"
$logFile = Join-Path $logDir "scheduled_task.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$sig = @'
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
$es = Add-Type -MemberDefinition $sig -Name "Win32SleepRun1" -Namespace "Kernel32" -PassThru
$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1
[void]$es::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)

try {
  $startTs = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
  "=== RUN1 SCHEDULED START_JST=$startTs ===" | Out-File -FilePath $logFile -Append -Encoding utf8
  Set-Location $repoRoot
  & node scripts/run-api-url-batch.mjs `
    --run-id $runId `
    --worker CHIBA-PC-api `
    --service-tier flex `
    --id-list analysis/pilot_gemini_api_url/run1_p0_target_ids.json `
    --anchor-list analysis/pilot_gemini_api_url/anchor_selection_deviation.json `
    --run-budget-usd 8.36 `
    --max-duration-sec 900 `
    --purpose "run1_p0_58_plus_18_anchors_flex_overnight" *>> $logFile
  $rc = $LASTEXITCODE
  $summaryPath = Join-Path $repoRoot "analysis\runs\$runId\run_summary.json"
  if ($rc -eq 0 -and (Test-Path $summaryPath)) {
    try {
      $summary = Get-Content -Path $summaryPath -Raw -Encoding utf8 | ConvertFrom-Json
      if ($summary.stopped_early -eq $true) {
        if ($summary.stop_reason -match "3_consecutive_deferred_videos|deferred_retry_pass_congestion") {
          $rc = 3
        } elseif ($summary.stop_reason -match "budget_cap_exceeded|max_requests_") {
          $rc = 4
        } else {
          $rc = 1
        }
      }
    } catch {
      $rc = 1
    }
  }
  $endTs = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
  "=== RUN1 SCHEDULED END_JST=$endTs EXIT_CODE=$rc ===" | Out-File -FilePath $logFile -Append -Encoding utf8
  exit $rc
} finally {
  [void]$es::SetThreadExecutionState($ES_CONTINUOUS)
}
