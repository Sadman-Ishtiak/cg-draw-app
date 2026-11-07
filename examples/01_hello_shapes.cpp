// 01 — basic shapes: line, rectangle, circle, bar with BGI colors
#include <graphics.h>

int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");

    setcolor(YELLOW);
    line(50, 50, 300, 50);

    setcolor(GREEN);
    rectangle(50, 80, 250, 180);

    setcolor(RED);
    circle(400, 130, 80);

    setfillstyle(SOLID_FILL, BLUE);
    bar(50, 220, 250, 320);

    setfillstyle(HATCH_FILL, MAGENTA);
    bar(300, 220, 500, 320);

    setcolor(WHITE);
    outtextxy(50, 400, "Hello, Computer Graphics!");

    getch();
    closegraph();
    return 0;
}
