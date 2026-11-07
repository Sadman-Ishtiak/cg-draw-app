// conio.h — minimal shim so classic BGI programs that #include <conio.h>
// for getch()/kbhit() compile. Same implementations as graphics.h.
#ifndef CG_DRAW_CONIO_H
#define CG_DRAW_CONIO_H

#ifdef __cplusplus
extern "C" {
#endif
int getch(void);
int kbhit(void);
#ifdef __cplusplus
}
#endif

#endif
