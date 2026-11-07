// graphics.h — winbgi-compatible shim for cg-draw-app
// Implements the subset of the Borland/winbgi graphics API used by the course.
// Anything not declared here is intentionally a compile-time error.
#ifndef CG_DRAW_GRAPHICS_H
#define CG_DRAW_GRAPHICS_H

// ---------------------------------------------------------------------------
// Constants and enums (winbgi-compatible values)
// ---------------------------------------------------------------------------
#define NORM_WIDTH      1
#define THICK_WIDTH     3

#define HORIZ_DIR       0
#define VERT_DIR        1

#define MAXCOLORS       15

enum colors { BLACK, BLUE, GREEN, CYAN, RED, MAGENTA, BROWN, LIGHTGRAY, DARKGRAY,
              LIGHTBLUE, LIGHTGREEN, LIGHTCYAN, LIGHTRED, LIGHTMAGENTA, YELLOW, WHITE };

enum line_styles { SOLID_LINE, DOTTED_LINE, CENTER_LINE, DASHED_LINE, USERBIT_LINE };

enum fill_styles { EMPTY_FILL, SOLID_FILL, LINE_FILL, LTSLASH_FILL, SLASH_FILL,
                   BKSLASH_FILL, LTBKSLASH_FILL, HATCH_FILL, XHATCH_FILL, INTERLEAVE_FILL,
                   WIDE_DOT_FILL, CLOSE_DOT_FILL, USER_FILL };

enum graphics_drivers { DETECT, CGA, MCGA, EGA, EGA64, EGAMONO, IBM8514, HERCMONO,
                        ATT400, VGA, PC3270 };

enum graphics_modes { CGAC0, CGAC1, CGAC2, CGAC3, CGAHI,
                      MCGAC0 = 0, MCGAC1, MCGAC2, MCGAC3, MCGAMED, MCGAHI,
                      EGALO = 0, EGAHI,
                      EGA64LO = 0, EGA64HI,
                      EGAMONOHI = 3,
                      HERCMONOHI = 0,
                      ATT400C0 = 0, ATT400C1, ATT400C2, ATT400C3, ATT400MED, ATT400HI,
                      VGALO = 0, VGAMED, VGAHI,
                      PC3270HI = 0,
                      IBM8514LO = 0, IBM8514HI };

enum graph_errors { grOk = 0 };

enum font_names { DEFAULT_FONT, TRIPLEX_FONT, SMALL_FONT, SANS_SERIF_FONT,
                  GOTHIC_FONT, SCRIPT_FONT, SIMPLEX_FONT, TRIPLEX_SCR_FONT,
                  COMPLEX_FONT, EUROPEAN_FONT, BOLD_FONT };

enum horiz { LEFT_TEXT, CENTER_TEXT, RIGHT_TEXT };
enum vertical { BOTTOM_TEXT, VCENTER_TEXT, TOP_TEXT };

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------
struct arccoordstype
{
    int x, y;
    int xstart, ystart;
    int xend, yend;
};

struct fillsettingstype
{
    int pattern;
    int color;
};

struct linesettingstype
{
    int linestyle;
    unsigned upattern;
    int thickness;
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
#ifdef __cplusplus
extern "C" {
#endif

// Drawing
void putpixel(int x, int y, int color);
void line(int x1, int y1, int x2, int y2);
void lineto(int x, int y);
void linerel(int dx, int dy);
void circle(int x, int y, int radius);
void rectangle(int left, int top, int right, int bottom);
void bar(int left, int top, int right, int bottom);
void bar3d(int left, int top, int right, int bottom, int depth, int topflag);
void ellipse(int x, int y, int stangle, int endangle, int xradius, int yradius);
void arc(int x, int y, int stangle, int endangle, int radius);
void pieslice(int x, int y, int stangle, int endangle, int radius);
void sector(int x, int y, int stangle, int endangle, int xradius, int yradius);
void fillellipse(int x, int y, int xradius, int yradius);
void fillpoly(int numpoints, int *polypoints);
void drawpoly(int numpoints, int *polypoints);
void floodfill(int x, int y, int border);

// Current position
void moveto(int x, int y);
void moverel(int dx, int dy);
int  getx(void);
int  gety(void);

// State
void setcolor(int color);
int  getcolor(void);
void setbkcolor(int color);
int  getbkcolor(void);
void setfillstyle(int pattern, int color);
void getfillsettings(struct fillsettingstype *fillinfo);
void setfillpattern(char *upattern, int color);
void setlinestyle(int linestyle, unsigned upattern, int thickness);
void getlinesettings(struct linesettingstype *lineinfo);

// Query
int  getpixel(int x, int y);
int  getmaxx(void);
int  getmaxy(void);
int  getmaxwidth(void);
int  getmaxheight(void);
int  getmaxcolor(void);
void getarccoords(struct arccoordstype *arccoords);
void getaspectratio(int *xasp, int *yasp);

// Screen / ceremony
void initgraph(int *graphdriver, int *graphmode, char *pathtodriver);
void detectgraph(int *graphdriver, int *graphmode);
int  initwindow(int width, int height, const char *title = "Windows BGI",
                int left = 0, int top = 0, bool dbflag = false, bool closeflag = true);
void closegraph(int wid = 0);
void cleardevice(void);
void clearviewport(void);
void graphdefaults(void);
int  getgraphmode(void);
void setgraphmode(int mode);
int  getmaxmode(void);
char *getmodename(int mode_number);
void getmoderange(int graphdriver, int *lomode, int *himode);
char *getdrivername(void);
int  graphresult(void);
char *grapherrormsg(int errorcode);

// Text
void outtext(char *textstring);
void outtextxy(int x, int y, char *textstring);
void settextstyle(int font, int direction, int charsize);
void settextjustify(int horiz, int vert);
int  textheight(char *textstring);
int  textwidth(char *textstring);

// Input / timing
int  getch(void);
int  kbhit(void);
void delay(int msec);

// Color helpers
int  converttorgb(int color);
int  getdisplaycolor(int color);
int  COLOR(int r, int g, int b);

#define IS_BGI_COLOR(v)     (((v) >= 0) && ((v) < 16))
#define IS_RGB_COLOR(v)     (((v) & 0x03000000) != 0)
#define RED_VALUE(v)        ((converttorgb(v) >> 16) & 0xFF)
#define GREEN_VALUE(v)      ((converttorgb(v) >> 8) & 0xFF)
#define BLUE_VALUE(v)       ((converttorgb(v)) & 0xFF)

#ifdef __cplusplus
}
#endif

#endif // CG_DRAW_GRAPHICS_H
