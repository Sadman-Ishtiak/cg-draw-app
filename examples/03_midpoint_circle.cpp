// 03 — midpoint circle algorithm implemented with putpixel
#include <graphics.h>

void midpoint_circle(int xc, int yc, int r, int color) {
    int x = 0, y = r;
    int d = 1 - r;
    while (x <= y) {
        putpixel(xc + x, yc + y, color);
        putpixel(xc - x, yc + y, color);
        putpixel(xc + x, yc - y, color);
        putpixel(xc - x, yc - y, color);
        putpixel(xc + y, yc + x, color);
        putpixel(xc - y, yc + x, color);
        putpixel(xc + y, yc - x, color);
        putpixel(xc - y, yc - x, color);
        if (d < 0) d += 2 * x + 3;
        else { d += 2 * (x - y) + 5; y--; }
        x++;
    }
}

int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");

    for (int r = 20; r <= 200; r += 20)
        midpoint_circle(320, 240, r, YELLOW);

    getch();
    closegraph();
    return 0;
}
