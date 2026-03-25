# ずんだもんで音声通知するスクリプト
# 引数でテキストを指定可能。省略時はデフォルトメッセージ
param(
    [string]$Text = "許可を求めているのだ、確認してほしいのだ"
)

try {
    $encoded = [uri]::EscapeDataString($Text)
    $queryUrl = "http://localhost:50021/audio_query?text=$encoded&speaker=3"
    $query = Invoke-RestMethod -Uri $queryUrl -Method Post -ErrorAction Stop

    $body = $query | ConvertTo-Json -Depth 10
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)

    $req = [System.Net.WebRequest]::Create("http://localhost:50021/synthesis?speaker=3")
    $req.Method = "POST"
    $req.ContentType = "application/json"
    $req.ContentLength = $bodyBytes.Length
    $reqStream = $req.GetRequestStream()
    $reqStream.Write($bodyBytes, 0, $bodyBytes.Length)
    $reqStream.Close()

    $resp = $req.GetResponse()
    $respStream = $resp.GetResponseStream()
    $ms = New-Object System.IO.MemoryStream
    $respStream.CopyTo($ms)
    $wavBytes = $ms.ToArray()

    $tmp = [IO.Path]::GetTempFileName() -replace '\.tmp$', '.wav'
    [IO.File]::WriteAllBytes($tmp, $wavBytes)

    $player = New-Object System.Media.SoundPlayer($tmp)
    $player.PlaySync()
    $player.Dispose()
    Remove-Item $tmp -ErrorAction SilentlyContinue
} catch {
    # VOICEVOXが起動していない場合は無視
    exit 0
}
