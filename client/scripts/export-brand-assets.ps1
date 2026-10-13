$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# Export the approved artwork without redrawing, recolouring or cropping it.
$publicDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../public'))
$sourcePath = Join-Path $publicDir 'golden-batch-logo.jpeg'
$source = [Drawing.Image]::FromFile($sourcePath)
$background = $source.GetPixel(0, 0)

function Export-SquarePng([int]$size, [double]$coverage, [string]$path) {
    $bitmap = [Drawing.Bitmap]::new($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear($background)
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $scale = $size * $coverage / [Math]::Max($source.Width, $source.Height)
        $width = $source.Width * $scale
        $height = $source.Height * $scale
        $graphics.DrawImage($source, [single](($size - $width) / 2), [single](($size - $height) / 2), [single]$width, [single]$height)
        $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

try {
    $iconsDir = Join-Path $publicDir 'icons'
    [IO.Directory]::CreateDirectory($iconsDir) | Out-Null
    foreach ($size in @(192, 512)) {
        $filename = "golden-batch-icon-$size-v3.png"
        Export-SquarePng $size 0.94 (Join-Path $iconsDir $filename)
        foreach ($alias in @("golden-batch-icon-$size.png", "icon-$size.png")) {
            Copy-Item -LiteralPath (Join-Path $iconsDir $filename) -Destination (Join-Path $iconsDir $alias) -Force
        }
    }
    # A centred 68% square fits entirely inside the maskable icon's safe circle.
    Export-SquarePng 512 0.68 (Join-Path $iconsDir 'golden-batch-icon-512-maskable-v3.png')
    foreach ($alias in @('golden-batch-icon-512-maskable.png', 'icon-512-maskable.png')) {
        Copy-Item -LiteralPath (Join-Path $iconsDir 'golden-batch-icon-512-maskable-v3.png') -Destination (Join-Path $iconsDir $alias) -Force
    }
    Export-SquarePng 180 0.82 (Join-Path $iconsDir 'golden-batch-apple-touch-icon-v3.png')
    foreach ($alias in @('golden-batch-apple-touch-icon.png', 'apple-touch-icon.png')) {
        Copy-Item -LiteralPath (Join-Path $iconsDir 'golden-batch-apple-touch-icon-v3.png') -Destination (Join-Path $iconsDir $alias) -Force
    }
    Export-SquarePng 32 0.94 (Join-Path $iconsDir 'favicon-32-v3.png')

    # Retain legacy SVG URLs, embedding the exact supplied artwork for external consumers.
    $encoded = [Convert]::ToBase64String([IO.File]::ReadAllBytes($sourcePath))
    $svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {0} {1}" role="img" aria-label="The Golden Batch"><image width="{0}" height="{1}" href="data:image/jpeg;base64,{2}" /></svg>' -f $source.Width, $source.Height, $encoded
    foreach ($name in @('logo.svg', 'logo-dark.svg', 'logo-mark.svg')) {
        [IO.File]::WriteAllText((Join-Path $publicDir $name), $svg, [Text.UTF8Encoding]::new($false))
    }

    # Multi-resolution ICO using lossless PNG frames.
    $frames = @()
    foreach ($size in @(16, 32, 48, 256)) {
        $temp = Join-Path $iconsDir "favicon-$size.tmp.png"
        Export-SquarePng $size 0.94 $temp
        $frames += @{ Size = $size; Bytes = [IO.File]::ReadAllBytes($temp) }
        Remove-Item -LiteralPath $temp
    }
    $stream = [IO.MemoryStream]::new()
    $writer = [IO.BinaryWriter]::new($stream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$frames.Count)
        $offset = 6 + 16 * $frames.Count
        foreach ($frame in $frames) {
            $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
            $writer.Write([byte]$dimension)
            $writer.Write([byte]$dimension)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$frame.Bytes.Length)
            $writer.Write([uint32]$offset)
            $offset += $frame.Bytes.Length
        }
        foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
        [IO.File]::WriteAllBytes((Join-Path $publicDir 'favicon.ico'), $stream.ToArray())
    } finally {
        $writer.Dispose()
        $stream.Dispose()
    }
} finally {
    $source.Dispose()
}
