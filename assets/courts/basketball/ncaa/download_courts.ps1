# Download NCAA basketball court images from Wikimedia Commons using the API
# Step 1: Search for exact file names, Step 2: Get download URL, Step 3: Download
$outDir = $PSScriptRoot

# Known exact Wikimedia filenames for NCAA basketball court images
$courtFiles = @(
    @{name="duke"; file="Cameron_Indoor_Stadium_interior.jpg"},
    @{name="unc"; file="Dean_Smith_Center_-_court.jpg"},
    @{name="kansas"; file="Allen_Fieldhouse_basketball.jpg"},
    @{name="kentucky"; file="Rupp_Arena_2019.jpg"},
    @{name="gonzaga"; file="McCarthey_Athletic_Center_Interior.jpg"},
    @{name="purdue"; file="Mackey_Arena_interior_2011.jpg"},
    @{name="michigan_state"; file="Breslin_Center_basketball.jpg"},
    @{name="villanova"; file="Finneran_Pavilion_interior.jpg"},
    @{name="south_carolina"; file="Colonial_Life_Arena_interior.jpg"},
    @{name="iowa"; file="Carver-Hawkeye_Arena_interior_2.jpg"},
    @{name="notre_dame"; file="Joyce_Center_Basketball.jpg"},
    @{name="ucla"; file="Pauley_Pavilion_Renovation_1.jpg"},
    @{name="uconn"; file="Gampel_Pavilion_Interior.jpg"},
    @{name="indiana"; file="Assembly_Hall_IU.jpg"},
    @{name="syracuse"; file="Carrier_Dome_basketball.jpg"},
    @{name="arizona"; file="McKale_Center_interior.jpg"}
)

$headers = @{ "User-Agent" = "Q4NT-Sports-Panel/1.0 (Sports research platform; contact@q4nt.com)" }

foreach ($court in $courtFiles) {
    $fileName = $court.file
    $outFile = Join-Path $outDir "$($court.name).jpg"
    Write-Host "Searching for $($court.name) ($fileName)..."
    
    try {
        # Use Wikimedia API to get the actual image URL
        $apiUrl = "https://en.wikipedia.org/w/api.php?action=query&titles=File:$fileName&prop=imageinfo&iiprop=url&iiurlwidth=1280&format=json"
        $response = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec 15
        
        $pages = $response.query.pages
        $pageId = ($pages | Get-Member -MemberType NoteProperty | Select-Object -First 1).Name
        
        if ($pageId -eq "-1") {
            Write-Host "  File not found on Wikipedia, trying search..."
            # Try searching
            $searchUrl = "https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=$($court.name -replace '_',' ') basketball arena court&srnamespace=6&srlimit=3&format=json"
            $searchResult = Invoke-RestMethod -Uri $searchUrl -Headers $headers -TimeoutSec 15
            if ($searchResult.query.search.Count -gt 0) {
                $foundTitle = $searchResult.query.search[0].title
                Write-Host "  Found: $foundTitle"
                $apiUrl2 = "https://commons.wikimedia.org/w/api.php?action=query&titles=$foundTitle&prop=imageinfo&iiprop=url&iiurlwidth=1280&format=json"
                $response2 = Invoke-RestMethod -Uri $apiUrl2 -Headers $headers -TimeoutSec 15
                $pages2 = $response2.query.pages
                $pageId2 = ($pages2 | Get-Member -MemberType NoteProperty | Select-Object -First 1).Name
                if ($pageId2 -ne "-1") {
                    $imgInfo = $pages2.$pageId2.imageinfo[0]
                    $downloadUrl = if ($imgInfo.thumburl) { $imgInfo.thumburl } else { $imgInfo.url }
                    Write-Host "  Downloading: $downloadUrl"
                    Invoke-WebRequest -Uri $downloadUrl -OutFile $outFile -Headers $headers -TimeoutSec 30
                    Write-Host "  Saved: $outFile ($(((Get-Item $outFile).Length / 1KB).ToString('N0')) KB)"
                }
            } else {
                Write-Host "  No results found"
            }
        } else {
            $imgInfo = $pages.$pageId.imageinfo[0]
            $downloadUrl = if ($imgInfo.thumburl) { $imgInfo.thumburl } else { $imgInfo.url }
            Write-Host "  Downloading: $downloadUrl"
            Invoke-WebRequest -Uri $downloadUrl -OutFile $outFile -Headers $headers -TimeoutSec 30
            Write-Host "  Saved: $outFile ($(((Get-Item $outFile).Length / 1KB).ToString('N0')) KB)"
        }
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)"
    }
    Start-Sleep -Milliseconds 1000
}
Write-Host "`nDone! Downloaded NCAA court images to: $outDir"
