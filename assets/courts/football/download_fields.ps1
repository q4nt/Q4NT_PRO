# Download LATEST NFL field images from gridiron-uniforms.com
# The page lists fields chronologically (oldest first), so we find ALL matches and take the LAST one
$baseUrl = "https://www.gridiron-uniforms.com/fields/controller/controller.php"
$imgBase = "https://www.gridiron-uniforms.com/fields/images/regular-season"
$outDir = $PSScriptRoot

$teams = @(
    @{id="ARZ"; city="Arizona"; name="Cardinals"},
    @{id="ATL"; city="Atlanta"; name="Falcons"},
    @{id="BAL"; city="Baltimore"; name="Ravens"},
    @{id="BUF"; city="Buffalo"; name="Bills"},
    @{id="CAR"; city="Carolina"; name="Panthers"},
    @{id="CHI"; city="Chicago"; name="Bears"},
    @{id="CIN"; city="Cincinnati"; name="Bengals"},
    @{id="CLE"; city="Cleveland"; name="Browns"},
    @{id="DAL"; city="Dallas"; name="Cowboys"},
    @{id="DEN"; city="Denver"; name="Broncos"},
    @{id="DET"; city="Detroit"; name="Lions"},
    @{id="GB"; city="Green Bay"; name="Packers"},
    @{id="HOU"; city="Houston"; name="Texans"},
    @{id="IND"; city="Indianapolis"; name="Colts"},
    @{id="JAX"; city="Jacksonville"; name="Jaguars"},
    @{id="KC"; city="Kansas City"; name="Chiefs"},
    @{id="LV"; city="Las Vegas"; name="Raiders"},
    @{id="LAC"; city="Los Angeles"; name="Chargers"},
    @{id="LAR"; city="Los Angeles"; name="Rams"},
    @{id="MIA"; city="Miami"; name="Dolphins"},
    @{id="MIN"; city="Minnesota"; name="Vikings"},
    @{id="NE"; city="New England"; name="Patriots"},
    @{id="NO"; city="New Orleans"; name="Saints"},
    @{id="NYG"; city="New York"; name="Giants"},
    @{id="NYJ"; city="New York"; name="Jets"},
    @{id="PHI"; city="Philadelphia"; name="Eagles"},
    @{id="PIT"; city="Pittsburgh"; name="Steelers"},
    @{id="SF"; city="San Francisco"; name="49ers"},
    @{id="SEA"; city="Seattle"; name="Seahawks"},
    @{id="TB"; city="Tampa Bay"; name="Buccaneers"},
    @{id="TEN"; city="Tennessee"; name="Titans"},
    @{id="WSH"; city="Washington"; name="Commanders"}
)

foreach ($t in $teams) {
    $teamId = $t.id
    $teamName = $t.name.ToLower() -replace '\s+', '_'
    $url = "$baseUrl`?action=view-team-all&team_id=$teamId&city=$($t.city)&name=$($t.name)"
    
    Write-Host "Fetching $teamId ($($t.city) $($t.name))..."
    try {
        $html = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
        # Find ALL regular-season images and take the LAST one (most recent)
        $pattern = "fields/images/regular-season/$teamId/r235/([^""']+\.png)"
        $allMatches = [regex]::Matches($html.Content, $pattern)
        if ($allMatches.Count -gt 0) {
            $lastMatch = $allMatches[$allMatches.Count - 1]
            $thumbFile = $lastMatch.Groups[1].Value
            $hiResUrl = "$imgBase/$teamId/r1024/$thumbFile"
            $outFile = Join-Path $outDir "$teamName.png"
            Write-Host "  Latest: $hiResUrl (match $($allMatches.Count) of $($allMatches.Count))"
            Invoke-WebRequest -Uri $hiResUrl -OutFile $outFile -TimeoutSec 30
            Write-Host "  Saved: $outFile"
        } else {
            Write-Host "  WARNING: No regular-season field image found for $teamId"
        }
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)"
    }
    Start-Sleep -Milliseconds 500
}
Write-Host "`nDone! Downloaded latest fields to: $outDir"
