// 06 — student-implemented flood fill using getpixel/putpixel
#include <graphics.h>

void my_flood_fill(int x, int y, int fill, int old) {
    if (getpixel(x, y) != old) return;
    putpixel(x, y, fill);
    my_flood_fill(x + 1, y, fill, old);
    my_flood_fill(x - 1, y, fill, old);
    my_flood_fill(x, y + 1, fill, old);
    my_flood_fill(x, y - 1, fill, old);
}

int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");

    setcolor(WHITE);
    circle(320, 240, 100);
    circle(320, 240, 60);

    my_flood_fill(320, 240, RED, BLACK);
    my_flood_fill(320, 160, GREEN, BLACK);

    outtextxy(250, 420, "Flood fill complete");

    getch();
    closegraph();
    return 0;
}
