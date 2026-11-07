// run.exe — tiny native Windows launcher for cg-draw-app (replaces run.bat).
//
// Resolves the app dir from its own path, points CGD_EMSDK / CGD_SHIM at the
// bundled toolchain + shim next to it, then starts cg-draw-app.exe and waits.
// Cross-compile with MinGW (static, so no runtime DLLs are required on the
// target):
//   x86_64-w64-mingw32-gcc -O2 -static -o run.exe launcher.c -lkernel32
#include <windows.h>
#include <stdio.h>
#include <string.h>

// Directory of this executable, without a trailing backslash.
static int self_dir(char *out, size_t n) {
  char full[MAX_PATH];
  if (GetModuleFileNameA(NULL, full, MAX_PATH) == 0) return 0;
  char *slash = strrchr(full, '\\');
  if (!slash || slash == full) return 0;
  *slash = '\0';
  size_t len = (size_t)(slash - full);
  if (len >= n) len = n - 1;
  memcpy(out, full, len);
  out[len] = '\0';
  return 1;
}

int main(int argc, char **argv) {
  char dir[MAX_PATH];
  if (!self_dir(dir, sizeof dir)) {
    MessageBoxA(NULL, "Could not resolve the app directory.", "CG Draw", MB_OK);
    return 1;
  }

  char emsdk[MAX_PATH], shim[MAX_PATH], app[MAX_PATH];
  snprintf(emsdk, sizeof emsdk, "%s\\emsdk", dir);
  snprintf(shim, sizeof shim, "%s\\shim", dir);
  snprintf(app, sizeof app, "%s\\cg-draw-app.exe", dir);

  // Point the app at the bundled offline toolchain + shim (no external install).
  SetEnvironmentVariableA("CGD_EMSDK", emsdk);
  SetEnvironmentVariableA("CGD_SHIM", shim);

  // Build "<app>" [arg ...]
  char cmdline[MAX_PATH + 1024];
  snprintf(cmdline, sizeof cmdline, "\"%s\"", app);
  size_t len = strlen(cmdline);
  for (int i = 1; i < argc; i++) {
    char part[1024];
    snprintf(part, sizeof part, " \"%s\"", argv[i]);
    if (len + strlen(part) + 1 > sizeof cmdline) break;
    strcat(cmdline, part);
    len = strlen(cmdline);
  }

  STARTUPINFOA si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof si);
  si.cb = sizeof si;
  ZeroMemory(&pi, sizeof pi);

  // Pass NULL for the environment so the current process env (with the
  // CGD_* vars we just set) is inherited.
  if (!CreateProcessA(app, cmdline, NULL, NULL, FALSE, 0, NULL, dir, &si, &pi)) {
    char msg[1024];
    snprintf(msg, sizeof msg,
             "Failed to start %s (error %lu).\n\nMake sure the WebView2 runtime "
             "is installed (ships with current Windows 10/11).",
             app, (unsigned long)GetLastError());
    MessageBoxA(NULL, msg, "CG Draw", MB_OK | MB_ICONERROR);
    return 1;
  }
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 0;
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);
  return (int)code;
}
