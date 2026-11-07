# package-windows.ps1 - build a portable Windows distribution of cg-draw-app.
#
# This script must be run ON WINDOWS. A Windows Tauri build needs the MSVC
# linker and the WebView2 headers, which cannot be cross-compiled with the
# MinGW toolchain alone. On a Linux box, build the Linux .tar.gz with
# package.sh instead.
#
# Output: dist\cg-draw-app-windows-x86_64.zip containing the same layout as the
# Linux tarball (binary, emsdk, shim, examples, ui, run.bat).
#
# Prerequisites (one time):
#   - Rust stable + the MSVC target:
#       rustup target add x86_64-pc-windows-msvc
#   - "Desktop development with C++" Visual Studio workload (MSVC + Windows SDK)
#   - Tauri CLI:  cargo install tauri-cli --version "^2"
#   - Emscripten SDK checked out at .\emsdk and activated:
#       .\emsdk\emsdk install latest ; .\emsdk\emsdk activate latest
#
# Unsigned-build notes (plan section 9.C):
#   - The produced .exe is UNSIGNED. Windows SmartScreen will warn on first run;
#     the user chooses "More info" -> "Run anyway". Sign later with a code-signing
#     certificate (signtool) to remove the warning.
#   - WebView2 ships with current Windows 10/11. On older machines install the
#     WebView2 Evergreen Bootstrapper once.

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dist = Join-Path $Root 'dist'
$Name = 'cg-draw-app-windows-x86_64'
$Stage = Join-Path $Dist $Name

Write-Host '== building release binary =='
Push-Location (Join-Path $Root 'src-tauri')
cargo build --release --target x86_64-pc-windows-msvc
Pop-Location

$Exe = Join-Path $Root 'src-tauri\target\x86_64-pc-windows-msvc\release\cg-draw-app.exe'
if (-not (Test-Path $Exe)) { throw "release binary not found: $Exe" }

Write-Host "== staging $Stage =="
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path $Stage | Out-Null
Copy-Item $Exe $Stage
Copy-Item -Recurse (Join-Path $Root 'shim')     $Stage
Copy-Item -Recurse (Join-Path $Root 'examples') $Stage
Copy-Item -Recurse (Join-Path $Root 'ui')       $Stage

Write-Host '== bundling emsdk (the offline compiler) =='
New-Item -ItemType Directory -Path (Join-Path $Stage 'emsdk') | Out-Null
Copy-Item -Recurse (Join-Path $Root 'emsdk\upstream') (Join-Path $Stage 'emsdk')
if (Test-Path (Join-Path $Root 'emsdk\node')) {
  Copy-Item -Recurse (Join-Path $Root 'emsdk\node') (Join-Path $Stage 'emsdk')
}
# emsdk-embedded config: emcc finds it two levels up from emcc; $CFGDIR inside
# expands to the directory holding it, so the copy works from any location.
Copy-Item (Join-Path $Root 'emsdk\.emscripten') (Join-Path $Stage 'emsdk')

@'
@echo off
rem Launch cg-draw-app. Sets CGD_EMSDK / CGD_SHIM so the app finds the bundled
rem toolchain and shim, and EM_CONFIG for the bundled emcc configuration.
set HERE=%~dp0
set CGD_EMSDK=%HERE%emsdk
set CGD_SHIM=%HERE%shim
set EM_CONFIG=%HERE%emsdk\.emscripten
"%HERE%cg-draw-app.exe" %*
'@ | Set-Content -Encoding ASCII (Join-Path $Stage 'run.bat')

@'
cg-draw-app - offline code editor + animated BGI canvas for a CG course.

Run:      run.bat
Requires: WebView2 runtime (bundled with current Windows 10/11; otherwise
          install the Evergreen Bootstrapper once).

Everything else - the C++ compiler (Emscripten), the graphics shim and the
sample programs - is bundled. No network access is needed at any point.

This build is unsigned. If SmartScreen warns on first launch, choose
"More info" -> "Run anyway".
'@ | Set-Content -Encoding ASCII (Join-Path $Stage 'README.txt')

Write-Host '== creating zip =='
$Zip = Join-Path $Dist "$Name.zip"
if (Test-Path $Zip) { Remove-Item $Zip }
Compress-Archive -Path $Stage -DestinationPath $Zip
Write-Host "PACKAGE_OK: $Zip"
