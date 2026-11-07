// 05 — course-style sample: y = m*x + c drawn with putpixel
#include <graphics.h>

int y_fun(int x) {
    int m = -2.4;
    int c = 1000;
    return (int)(m*x + c + 0.5);
}

int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");

    // for(int i = 0; i < 500; i+=1) {
    //     for(int j = 0; j <= 500; j+=1) {
    //         putpixel(i, j, COLOR((i*j)%256, (i*i)%256, (j*j)%256));
    //         // putpixel(j, i, WHITE);
    //     }
    // }

    for(int i = 0; i < 500; i++) {
        putpixel(i, y_fun(i), WHITE);
    }

    closegraph();
    return 0;
}
