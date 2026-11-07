// 04 — animation: the drawing process plays live; delay() paces it
#include <graphics.h>

int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");

    setbkcolor(BLUE);
    cleardevice();

    // a bouncing ball drawn frame by frame
    int x = 50, y = 100, dir = 1;
    for (int frame = 0; frame < 120; frame++) {
        cleardevice();
        setcolor(YELLOW);
        setfillstyle(SOLID_FILL, YELLOW);
        fillellipse(x, y, 20, 20);

        x += 5 * dir;
        if (x > 590 || x < 50) dir = -dir;
        y = 100 + (frame % 40 < 20 ? frame % 40 : 40 - frame % 40);

        delay(40);
    }

    setcolor(WHITE);
    outtextxy(220, 300, "Animation done");

    getch();
    closegraph();
    return 0;
}
