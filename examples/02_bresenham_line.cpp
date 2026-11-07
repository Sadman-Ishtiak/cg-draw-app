// 02 — Bresenham line algorithm implemented with putpixel (classic CG exercise)
#include <graphics.h>

void bresenham(int x1, int y1, int x2, int y2, int color) {
    int dx = x2 - x1, dy = y2 - y1;
    int ix = dx > 0 ? 1 : -1, iy = dy > 0 ? 1 : -1;
    if (dx < 0) dx = -dx;
    if (dy < 0) dy = -dy;

    int x = x1, y = y1;
    if (dx >= dy) {
        int p = 2 * dy - dx;
        for (int k = 0; k <= dx; k++) {
            putpixel(x, y, color);
            if (p < 0) p += 2 * dy;
            else { p += 2 * dy - 2 * dx; y += iy; }
            x += ix;
        }
    } else {
        int p = 2 * dx - dy;
        for (int k = 0; k <= dy; k++) {
            putpixel(x, y, color);
            if (p < 0) p += 2 * dx;
            else { p += 2 * dx - 2 * dy; x += ix; }
            y += iy;
        }
    }
}

int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");

    bresenham(0, 0, 639, 479, WHITE);
    bresenham(639, 0, 0, 479, CYAN);
    bresenham(320, 40, 320, 440, GREEN);
    bresenham(60, 240, 580, 240, RED);

    getch();
    closegraph();
    return 0;
}
