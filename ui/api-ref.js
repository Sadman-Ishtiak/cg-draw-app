// api-ref.js — the winbgi-compatible surface declared in shim/graphics.h.
// Single source of truth for autocomplete and signature tooltips. Keep in
// sync with graphics.h.

window.CG_API = {
  // name, full signature, one-line help, and the parameter names used by the
  // insert toolbar (comma-separated inside sig).
  functions: [
    { name: 'initgraph', sig: 'void initgraph(int *gd, int *gm, char *path)', desc: 'Open the graphics window. Use int gd = DETECT, gm;' },
    { name: 'initwindow', sig: 'int initwindow(int w, int h, const char *title)', desc: 'Open a window of an exact size (overrides the mode table).' },
    { name: 'closegraph', sig: 'void closegraph()', desc: 'Close the graphics window.' },
    { name: 'detectgraph', sig: 'void detectgraph(int *gd, int *gm)', desc: 'Detect driver/mode (no-op).' },
    { name: 'cleardevice', sig: 'void cleardevice()', desc: 'Clear the screen with the background color.' },
    { name: 'clearviewport', sig: 'void clearviewport()', desc: 'Clear the screen.' },

    { name: 'putpixel', sig: 'void putpixel(int x, int y, int color)', desc: 'Draw a single pixel.' },
    { name: 'line', sig: 'void line(int x1, int y1, int x2, int y2)', desc: 'Draw a line in the current color.' },
    { name: 'lineto', sig: 'void lineto(int x, int y)', desc: 'Line from the current position to (x,y), then move there.' },
    { name: 'linerel', sig: 'void linerel(int dx, int dy)', desc: 'Line relative to the current position.' },
    { name: 'circle', sig: 'void circle(int x, int y, int radius)', desc: 'Draw a circle outline.' },
    { name: 'rectangle', sig: 'void rectangle(int left, int top, int right, int bottom)', desc: 'Draw a rectangle outline.' },
    { name: 'bar', sig: 'void bar(int left, int top, int right, int bottom)', desc: 'Filled rectangle using the fill style/color.' },
    { name: 'bar3d', sig: 'void bar3d(int left, int top, int right, int bottom, int depth, int topflag)', desc: 'Filled 3-D bar.' },
    { name: 'ellipse', sig: 'void ellipse(int x, int y, int stangle, int endangle, int xradius, int yradius)', desc: 'Elliptical arc.' },
    { name: 'arc', sig: 'void arc(int x, int y, int stangle, int endangle, int radius)', desc: 'Circular arc in degrees.' },
    { name: 'pieslice', sig: 'void pieslice(int x, int y, int stangle, int endangle, int radius)', desc: 'Filled pie slice.' },
    { name: 'sector', sig: 'void sector(int x, int y, int stangle, int endangle, int xr, int yr)', desc: 'Filled elliptical sector.' },
    { name: 'fillellipse', sig: 'void fillellipse(int x, int y, int xradius, int yradius)', desc: 'Filled ellipse.' },
    { name: 'fillpoly', sig: 'void fillpoly(int numpoints, int *polypoints)', desc: 'Filled polygon; points as x,y pairs.' },
    { name: 'drawpoly', sig: 'void drawpoly(int numpoints, int *polypoints)', desc: 'Polygon outline; points as x,y pairs.' },
    { name: 'floodfill', sig: 'void floodfill(int x, int y, int border)', desc: 'Fill a bordered region with the fill style/color.' },

    { name: 'moveto', sig: 'void moveto(int x, int y)', desc: 'Set the current position.' },
    { name: 'moverel', sig: 'void moverel(int dx, int dy)', desc: 'Move the current position relatively.' },
    { name: 'getx', sig: 'int getx()', desc: 'Current x position.' },
    { name: 'gety', sig: 'int gety()', desc: 'Current y position.' },

    { name: 'setcolor', sig: 'void setcolor(int color)', desc: 'Set the drawing color.' },
    { name: 'getcolor', sig: 'int getcolor()', desc: 'Current drawing color.' },
    { name: 'setbkcolor', sig: 'void setbkcolor(int color)', desc: 'Set the background color.' },
    { name: 'getbkcolor', sig: 'int getbkcolor()', desc: 'Current background color.' },
    { name: 'setfillstyle', sig: 'void setfillstyle(int pattern, int color)', desc: 'Set fill pattern and color.' },
    { name: 'getfillsettings', sig: 'void getfillsettings(fillsettingstype *f)', desc: 'Read the fill settings.' },
    { name: 'setfillpattern', sig: 'void setfillpattern(char *pattern, int color)', desc: 'Set a user 8-byte fill pattern.' },
    { name: 'setlinestyle', sig: 'void setlinestyle(int style, unsigned pattern, int thickness)', desc: 'Set line style, pattern and width.' },
    { name: 'getlinesettings', sig: 'void getlinesettings(linesettingstype *l)', desc: 'Read the line settings.' },

    { name: 'getpixel', sig: 'int getpixel(int x, int y)', desc: 'Color of a pixel.' },
    { name: 'getmaxx', sig: 'int getmaxx()', desc: 'Rightmost x coordinate.' },
    { name: 'getmaxy', sig: 'int getmaxy()', desc: 'Bottom y coordinate.' },
    { name: 'getmaxwidth', sig: 'int getmaxwidth()', desc: 'Canvas width.' },
    { name: 'getmaxheight', sig: 'int getmaxheight()', desc: 'Canvas height.' },
    { name: 'getmaxcolor', sig: 'int getmaxcolor()', desc: 'Highest color value.' },
    { name: 'getarccoords', sig: 'void getarccoords(arccoordstype *a)', desc: 'Coordinates of the last arc.' },
    { name: 'getaspectratio', sig: 'void getaspectratio(int *xasp, int *yasp)', desc: 'Screen aspect ratio.' },

    { name: 'outtext', sig: 'void outtext(char *text)', desc: 'Draw text at the current position.' },
    { name: 'outtextxy', sig: 'void outtextxy(int x, int y, char *text)', desc: 'Draw text at (x,y).' },
    { name: 'settextstyle', sig: 'void settextstyle(int font, int direction, int charsize)', desc: 'Set font, direction and character size.' },
    { name: 'settextjustify', sig: 'void settextjustify(int horiz, int vert)', desc: 'Set text justification.' },
    { name: 'textheight', sig: 'int textheight(char *text)', desc: 'Height of a text string in pixels.' },
    { name: 'textwidth', sig: 'int textwidth(char *text)', desc: 'Width of a text string in pixels.' },

    { name: 'getch', sig: 'int getch()', desc: 'Wait for a key press; returns its code.' },
    { name: 'kbhit', sig: 'int kbhit()', desc: 'Non-zero if a key is waiting.' },
    { name: 'delay', sig: 'void delay(int msec)', desc: 'Pause for the given milliseconds.' },

    { name: 'COLOR', sig: 'int COLOR(int r, int g, int b)', desc: 'Build an RGB color (0-255 each).' },
    { name: 'converttorgb', sig: 'int converttorgb(int color)', desc: 'RGB value of a color index.' },
    { name: 'getdisplaycolor', sig: 'int getdisplaycolor(int color)', desc: 'Displayed RGB value of a color.' },

    { name: 'getgraphmode', sig: 'int getgraphmode()', desc: 'Current graphics mode.' },
    { name: 'setgraphmode', sig: 'void setgraphmode(int mode)', desc: 'Switch graphics mode.' },
    { name: 'graphresult', sig: 'int graphresult()', desc: 'Result of the last graphics operation (grOk).' },
    { name: 'grapherrormsg', sig: 'char *grapherrormsg(int code)', desc: 'Message for an error code.' },
  ],

  // Named constants worth suggesting.
  constants: [
    'DETECT', 'VGA', 'VGAHI', 'VGAMED', 'VGALO', 'EGA', 'EGAHI', 'CGA', 'CGAHI',
    'MCGA', 'MCGAHI', 'IBM8514', 'MAXCOLORS', 'grOk',
    'BLACK', 'BLUE', 'GREEN', 'CYAN', 'RED', 'MAGENTA', 'BROWN', 'LIGHTGRAY',
    'DARKGRAY', 'LIGHTBLUE', 'LIGHTGREEN', 'LIGHTCYAN', 'LIGHTRED',
    'LIGHTMAGENTA', 'YELLOW', 'WHITE',
    'SOLID_LINE', 'DOTTED_LINE', 'CENTER_LINE', 'DASHED_LINE', 'USERBIT_LINE',
    'EMPTY_FILL', 'SOLID_FILL', 'LINE_FILL', 'LTSLASH_FILL', 'SLASH_FILL',
    'BKSLASH_FILL', 'LTBKSLASH_FILL', 'HATCH_FILL', 'XHATCH_FILL',
    'INTERLEAVE_FILL', 'WIDE_DOT_FILL', 'CLOSE_DOT_FILL', 'USER_FILL',
    'NORM_WIDTH', 'THICK_WIDTH', 'HORIZ_DIR', 'VERT_DIR',
    'LEFT_TEXT', 'CENTER_TEXT', 'RIGHT_TEXT', 'BOTTOM_TEXT', 'VCENTER_TEXT', 'TOP_TEXT',
    'DEFAULT_FONT', 'TRIPLEX_FONT', 'SMALL_FONT', 'SANS_SERIF_FONT', 'GOTHIC_FONT',
    'SCRIPT_FONT', 'SIMPLEX_FONT', 'TRIPLEX_SCR_FONT', 'COMPLEX_FONT',
    'EUROPEAN_FONT', 'BOLD_FONT',
  ],
};

// Identifier set used by the completer (functions + constants).
window.CG_API.words = window.CG_API.functions
  .map((f) => f.name)
  .concat(window.CG_API.constants);

// Look up a function by name (for tooltips).
window.CG_API.byName = (() => {
  const m = {};
  for (const f of window.CG_API.functions) m[f.name] = f;
  return (name) => m[name] || null;
})();

// C++ keywords worth completing alongside the shim API.
window.CG_API.keywords = [
  'include', 'int', 'char', 'void', 'for', 'while', 'if', 'else', 'return',
  'const', 'unsigned', 'bool', 'float', 'double', 'struct', 'class', 'break',
  'continue', 'true', 'false', 'new', 'delete', 'using', 'namespace', 'std',
];

// Pure completion filter: identifiers starting with `word` (case-insensitive),
// falling back to the full list. Returns {list, from}.
window.CG_API.complete = function (word) {
  const all = window.CG_API.words.concat(window.CG_API.keywords);
  const lower = (word || '').toLowerCase();
  const hits = all.filter((w) => w.toLowerCase().startsWith(lower));
  return { list: hits.length ? hits : all, word: word || '' };
};

// Pure tooltip detector: given a line and a column, return the shim function
// being called immediately before the cursor, or null.
window.CG_API.callBefore = function (line, col) {
  if (typeof line !== 'string') return null;
  const before = line.slice(0, col);
  const m = before.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*$/);
  if (!m) return null;
  const fn = window.CG_API.byName(m[1]);
  return fn ? { fn, col: m.index } : null;
};

