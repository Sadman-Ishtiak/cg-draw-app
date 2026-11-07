// graphics_shim.cpp — implementation of the winbgi-compatible subset.
// State lives here; rasterization happens in JS (graphics_lib.js) on a pixel
// buffer in the worker, so getpixel() sees every primitive (needed for
// student-implemented flood fill etc.).
#include <graphics.h>
#include <string.h>
#include <stdint.h>
#include <math.h>

// --- JS bridge (implemented in graphics_lib.js) ----------------------------
extern "C" {
void js_initcanvas(int w, int h);
void js_putpixel(int x, int y, int c);
void js_line(int x1, int y1, int x2, int y2, int c, int style, int upat, int thick);
void js_circle(int x, int y, int r, int c, int style, int upat, int thick);
void js_ellipse(int x, int y, int st, int en, int xr, int yr, int c, int style, int upat, int thick);
void js_bar(int l, int t, int r, int b, int fc, int pidx, int uptr);
void js_fillellipse(int x, int y, int xr, int yr, int fc, int pidx, int uptr);
void js_fillpoly(int n, int ptr, int fc, int pidx, int uptr);
void js_floodfill(int x, int y, int border, int fc, int pidx, int uptr);
int  js_getpixel(int x, int y);
void js_clear(int c);
void js_delay(int ms);
int  js_getch(void);
int  js_kbhit(void);
int  js_outtextxy(int x, int y, char *s, int c, int cs, int hj, int vj);
void js_flush(void);
}

// --- state ------------------------------------------------------------------
static const int PAL16[16] = {
    0x000000, 0x0000AA, 0x00AA00, 0x00AAAA, 0xAA0000, 0xAA00AA, 0xAA5500, 0xAAAAAA,
    0x555555, 0x5555FF, 0x55FF55, 0x55FFFF, 0xFF5555, 0xFF55FF, 0xFFFF55, 0xFFFFFF
};

static int cur_color      = WHITE;
static int bg_color       = BLACK;
static int fill_pattern   = SOLID_FILL;
static int fill_color     = WHITE;
static int line_style     = SOLID_LINE;
static unsigned line_upat = 0xFFFF;
static int line_thick     = NORM_WIDTH;
static int cp_x = 0, cp_y = 0;
static int text_charsize = 1;
static int text_hjust = LEFT_TEXT;
static int text_vjust = TOP_TEXT;
static char user_pattern[8] = {(char)0xFF,(char)0xFF,(char)0xFF,(char)0xFF,
                               (char)0xFF,(char)0xFF,(char)0xFF,(char)0xFF};
static int canvas_w = 640, canvas_h = 480;
static int cur_driver = VGA, cur_mode = VGAHI;
static arccoordstype last_arc = {0,0,0,0,0,0};

static int resolve_color(int c)
{
    if (c >= 0 && c < 16) return c;
    if (c & 0x03000000) return c;
    return 0x03000000 | (c & 0xFFFFFF);
}

static void mode_size(int driver, int mode, int &w, int &h)
{
    switch (driver) {
        case CGA: case ATT400:   w = 320; h = 200; if (mode == CGAHI) { w = 640; h = 200; } break;
        case MCGA:               w = 320; h = 200;
                                 if (mode == MCGAMED) { w = 640; h = 350; }
                                 else if (mode == MCGAHI) { w = 640; h = 480; } break;
        case EGA: case EGA64:    w = 640; h = 200;
                                 if (mode == EGAHI || mode == EGA64HI) { w = 640; h = 350; } break;
        case EGAMONO: case HERCMONO: w = 720; h = 348; break;
        case IBM8514:            w = 640; h = 480; if (mode == IBM8514HI) { w = 1024; h = 768; } break;
        case PC3270:             w = 720; h = 350; break;
        default:                 w = 640; h = 200;
                                 if (mode == VGAMED) { w = 640; h = 350; }
                                 else if (mode == VGAHI) { w = 640; h = 480; } break;
    }
}

static void set_canvas(int w, int h)
{
    if (w < 1) w = 1;
    if (h < 1) h = 1;
    canvas_w = w; canvas_h = h;
    js_initcanvas(w, h);
}

static void arc_coords(int x, int y, int st, int en, int xr, int yr)
{
    double a0 = st * 3.14159265358979 / 180.0;
    double a1 = en * 3.14159265358979 / 180.0;
    last_arc.x = x; last_arc.y = y;
    last_arc.xstart = x + (int)(xr * cos(a0)); last_arc.ystart = y - (int)(yr * sin(a0));
    last_arc.xend   = x + (int)(xr * cos(a1)); last_arc.yend   = y - (int)(yr * sin(a1));
}

static void fill_pie(int x, int y, int st, int en, int xr, int yr)
{
    double a0 = st * 3.14159265358979 / 180.0;
    double a1 = en * 3.14159265358979 / 180.0;
    if (a1 <= a0) a1 += 2 * 3.14159265358979;
    int steps = xr > yr ? xr : yr;
    if (steps < 8) steps = 8;
    for (int i = 0; i <= steps; i++) {
        double a = a0 + (a1 - a0) * i / steps;
        js_line(x, y, x + (int)(xr * cos(a)), y - (int)(yr * sin(a)),
                fill_color, SOLID_LINE, 0xFFFF, 1);
    }
}

// --- ceremony ---------------------------------------------------------------
void initgraph(int *gd, int *gm, char *path)
{
    (void)path;
    int driver = gd ? *gd : DETECT;
    int mode   = gm ? *gm : 0;
    if (driver == DETECT) { driver = VGA; mode = VGAHI; }
    if (gd) *gd = driver;
    if (gm) *gm = mode;
    cur_driver = driver; cur_mode = mode;
    int w, h; mode_size(driver, mode, w, h);
    set_canvas(w, h);
    graphdefaults();
}

void detectgraph(int *gd, int *gm)
{
    if (gd) *gd = VGA;
    if (gm) *gm = VGAHI;
}

int initwindow(int width, int height, const char *title, int left, int top,
               bool dbflag, bool closeflag)
{
    (void)title; (void)left; (void)top; (void)dbflag; (void)closeflag;
    set_canvas(width, height);
    return 1;
}

void closegraph(int wid) { (void)wid; }
void clearviewport(void) { js_clear(bg_color); }
void cleardevice(void)   { js_clear(bg_color); }

int  getgraphmode(void) { return cur_mode; }
void setgraphmode(int mode)
{
    cur_mode = mode;
    int w, h; mode_size(cur_driver, mode, w, h);
    set_canvas(w, h);
}
int   getmaxmode(void) { return VGAHI; }
char *getmodename(int mode_number) { (void)mode_number; return (char*)"BGI mode"; }
void  getmoderange(int graphdriver, int *lomode, int *himode)
{
    (void)graphdriver;
    if (lomode) *lomode = 0;
    if (himode) *himode = VGAHI;
}
char *getdrivername(void) { return (char*)"CG Draw"; }
int   graphresult(void) { return grOk; }
char *grapherrormsg(int errorcode) { (void)errorcode; return (char*)"No error"; }

void graphdefaults(void)
{
    cur_color = WHITE; bg_color = BLACK;
    fill_pattern = SOLID_FILL; fill_color = WHITE;
    line_style = SOLID_LINE; line_upat = 0xFFFF; line_thick = NORM_WIDTH;
    cp_x = 0; cp_y = 0;
    text_charsize = 1; text_hjust = LEFT_TEXT; text_vjust = TOP_TEXT;
}

// --- current position --------------------------------------------------------
void moveto(int x, int y)  { cp_x = x; cp_y = y; }
void moverel(int dx, int dy) { cp_x += dx; cp_y += dy; }
int  getx(void) { return cp_x; }
int  gety(void) { return cp_y; }

// --- state -------------------------------------------------------------------
void setcolor(int c) { cur_color = resolve_color(c); }
int  getcolor(void)  { return cur_color; }
void setbkcolor(int c) { bg_color = resolve_color(c); }
int  getbkcolor(void)  { return bg_color; }

void setfillstyle(int p, int c) { fill_pattern = p; fill_color = resolve_color(c); }
void getfillsettings(struct fillsettingstype *f)
{
    if (f) { f->pattern = fill_pattern; f->color = fill_color; }
}
void setfillpattern(char *up, int c)
{
    if (up) memcpy(user_pattern, up, 8);
    fill_pattern = USER_FILL; fill_color = resolve_color(c);
}
void setlinestyle(int s, unsigned up, int t)
{
    line_style = s;
    line_upat = (s == USERBIT_LINE) ? up : 0xFFFFu;
    line_thick = t < 1 ? 1 : t;
}
void getlinesettings(struct linesettingstype *l)
{
    if (l) { l->linestyle = line_style; l->upattern = line_upat; l->thickness = line_thick; }
}

// --- drawing -------------------------------------------------------------------
void putpixel(int x, int y, int c) { js_putpixel(x, y, resolve_color(c)); }

void line(int x1, int y1, int x2, int y2)
{
    js_line(x1, y1, x2, y2, cur_color, line_style, (int)line_upat, line_thick);
}

void lineto(int x, int y)  { line(cp_x, cp_y, x, y); cp_x = x; cp_y = y; }
void linerel(int dx, int dy) { lineto(cp_x + dx, cp_y + dy); }

void circle(int x, int y, int r)
{
    js_circle(x, y, r, cur_color, line_style, (int)line_upat, line_thick);
}

void rectangle(int l, int t, int r, int b)
{
    line(l, t, r, t); line(r, t, r, b); line(r, b, l, b); line(l, b, l, t);
}

void bar(int l, int t, int r, int b)
{
    js_bar(l, t, r, b, fill_color, fill_pattern, (int)(intptr_t)user_pattern);
}

void bar3d(int l, int t, int r, int b, int depth, int topflag)
{
    bar(l, t, r, b);
    line(r, t, r + depth, t - depth);
    line(r + depth, t - depth, r + depth, b - depth);
    line(r + depth, b - depth, r, b);
    if (topflag) {
        line(l, t, r, t);
        line(l, t, l + depth, t - depth);
        line(l + depth, t - depth, r + depth, t - depth);
    }
}

void ellipse(int x, int y, int st, int en, int xr, int yr)
{
    arc_coords(x, y, st, en, xr, yr);
    js_ellipse(x, y, st, en, xr, yr, cur_color, line_style, (int)line_upat, line_thick);
}

void arc(int x, int y, int st, int en, int r)
{
    arc_coords(x, y, st, en, r, r);
    js_ellipse(x, y, st, en, r, r, cur_color, line_style, (int)line_upat, line_thick);
}

void pieslice(int x, int y, int st, int en, int r)
{
    arc_coords(x, y, st, en, r, r);
    fill_pie(x, y, st, en, r, r);
    js_ellipse(x, y, st, en, r, r, cur_color, SOLID_LINE, 0xFFFF, 1);
    double a0 = st * 3.14159265358979 / 180.0, a1 = en * 3.14159265358979 / 180.0;
    line(x, y, x + (int)(r * cos(a0)), y - (int)(r * sin(a0)));
    line(x, y, x + (int)(r * cos(a1)), y - (int)(r * sin(a1)));
}

void sector(int x, int y, int st, int en, int xr, int yr)
{
    arc_coords(x, y, st, en, xr, yr);
    fill_pie(x, y, st, en, xr, yr);
    js_ellipse(x, y, st, en, xr, yr, cur_color, SOLID_LINE, 0xFFFF, 1);
    double a0 = st * 3.14159265358979 / 180.0, a1 = en * 3.14159265358979 / 180.0;
    line(x, y, x + (int)(xr * cos(a0)), y - (int)(yr * sin(a0)));
    line(x, y, x + (int)(xr * cos(a1)), y - (int)(yr * sin(a1)));
}

void fillellipse(int x, int y, int xr, int yr)
{
    js_fillellipse(x, y, xr, yr, fill_color, fill_pattern, (int)(intptr_t)user_pattern);
}

void fillpoly(int numpoints, int *pts)
{
    if (numpoints < 2 || !pts) return;
    js_fillpoly(numpoints, (int)(intptr_t)pts, fill_color, fill_pattern,
                (int)(intptr_t)user_pattern);
    for (int i = 0; i < numpoints - 1; i++)
        line(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3]);
}

void drawpoly(int numpoints, int *pts)
{
    if (numpoints < 2 || !pts) return;
    for (int i = 0; i < numpoints - 1; i++)
        line(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3]);
}

void floodfill(int x, int y, int border)
{
    js_floodfill(x, y, resolve_color(border), fill_color, fill_pattern,
                 (int)(intptr_t)user_pattern);
}

// --- query ---------------------------------------------------------------------
int  getpixel(int x, int y) { return js_getpixel(x, y); }
int  getmaxx(void) { return canvas_w - 1; }
int  getmaxy(void) { return canvas_h - 1; }
int  getmaxwidth(void) { return canvas_w; }
int  getmaxheight(void) { return canvas_h; }
int  getmaxcolor(void) { return MAXCOLORS; }
void getarccoords(struct arccoordstype *a) { if (a) *a = last_arc; }
void getaspectratio(int *xasp, int *yasp)
{
    if (xasp) *xasp = 10000;
    if (yasp) *yasp = 10000;
}

// --- text ---------------------------------------------------------------------
void outtextxy(int x, int y, char *s)
{
    if (!s) return;
    js_outtextxy(x, y, s, cur_color, text_charsize, text_hjust, text_vjust);
}

void outtext(char *s)
{
    if (!s) return;
    int w = js_outtextxy(cp_x, cp_y, s, cur_color, text_charsize, text_hjust, text_vjust);
    cp_x += w;
}

void settextstyle(int font, int dir, int cs)
{
    (void)font;
    (void)dir; // vertical text not supported in v1; drawn horizontally
    text_charsize = cs < 1 ? 1 : cs;
}

void settextjustify(int h, int v) { text_hjust = h; text_vjust = v; }
int  textheight(char *s) { (void)s; return 8 * text_charsize; }
int  textwidth(char *s) { return s ? (int)strlen(s) * 8 * text_charsize : 0; }

// --- input / timing -------------------------------------------------------------
int  getch(void) { return js_getch(); }
int  kbhit(void) { return js_kbhit(); }
void delay(int msec) { js_delay(msec); }

// Emit one last frame before exiting so everything drawn after the final
// delay()/getch() still reaches the player (destructor runs at program end).
struct __CGFlushAtExit
{
    ~__CGFlushAtExit() { js_flush(); }
};
static __CGFlushAtExit __cg_flush_at_exit;

// --- color helpers ----------------------------------------------------------------
int converttorgb(int c)
{
    c = resolve_color(c);
    return (c >= 0 && c < 16) ? PAL16[c] : (c & 0xFFFFFF);
}

int getdisplaycolor(int c) { return converttorgb(c); }

int COLOR(int r, int g, int b)
{
    if (r < 0) r = 0; if (r > 255) r = 255;
    if (g < 0) g = 0; if (g > 255) g = 255;
    if (b < 0) b = 0; if (b > 255) b = 255;
    return 0x03000000 | (r << 16) | (g << 8) | b;
}
