/* KeepZotero Windows message bridge. Loaded inside Zotero, never an executable.
 * Forward synchronous shell callbacks to the worker's posted message queue.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#define TRAY_CALLBACK (WM_APP + 71)
#define TRAY_EVENT (WM_APP + 72)

__declspec(dllexport) LRESULT CALLBACK KeepZoteroWindowProc(
    HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    static UINT taskbarCreated;
    if (!taskbarCreated) taskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");
    if (message == TRAY_CALLBACK) {
        PostMessageW(hwnd, TRAY_EVENT, wParam, lParam);
        return 0;
    }
    if (taskbarCreated && message == taskbarCreated) {
        PostMessageW(hwnd, message, wParam, lParam);
        return 0;
    }
    return DefWindowProcW(hwnd, message, wParam, lParam);
}
