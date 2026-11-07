// graphics_lib.js — emscripten JS library for the graphics shim.
// Runs inside the Web Worker. Owns a color-int pixel buffer (pix) so that
// getpixel() sees every primitive, plus an RGBA mirror for rendering.
// Frames are flushed to the main thread ~60x/sec (batched).
// delay()/getch() use Asyncify so the worker event loop stays alive.
//
// NOTE: keep this file free of emscripten preprocessor macros; plain JS only.

var LibraryGraphics = {
    $CGI__deps: [],
    $CGI: {
        w: 0, h: 0, pix: null, rgba: null,
        dirty: false, texts: [], timer: null,
        fast: false, pendingKey: null, keyWake: null, installed: false,
        calls: 0,

        FILLPATS: [
            [0xFF,0x00,0x00,0x00,0x00,0x00,0x00,0x00],          // LINE_FILL
            [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80],          // LTSLASH_FILL
            [0xC0,0x30,0x0C,0x03,0xC0,0x30,0x0C,0x03],          // SLASH_FILL
            [0x03,0x0C,0x30,0xC0,0x03,0x0C,0x30,0xC0],          // BKSLASH_FILL
            [0x80,0x40,0x20,0x10,0x08,0x04,0x02,0x01],          // LTBKSLASH_FILL
            [0xFF,0x88,0x88,0x88,0xFF,0x88,0x88,0x88],          // HATCH_FILL
            [0x81,0x42,0x24,0x18,0x18,0x24,0x42,0x81],          // XHATCH_FILL
            [0xCC,0x33,0xCC,0x33,0xCC,0x33,0xCC,0x33],          // INTERLEAVE_FILL
            [0x80,0x00,0x08,0x00,0x80,0x00,0x08,0x00],          // WIDE_DOT_FILL
            [0x88,0x00,0x22,0x00,0x88,0x00,0x22,0x00]           // CLOSE_DOT_FILL
        ],

        PAL: [
            0x000000, 0x0000AA, 0x00AA00, 0x00AAAA, 0xAA0000, 0xAA00AA, 0xAA5500, 0xAAAAAA,
            0x555555, 0x5555FF, 0x55FF55, 0x55FFFF, 0xFF5555, 0xFF55FF, 0xFFFF55, 0xFFFFFF
        ],

        rgb: function (c) { return (c >= 0 && c < 16) ? this.PAL[c] : (c & 0xFFFFFF); },

        lineMask: function (style, upat) {
            if (style === 4) return upat & 0xFFFF;   // USERBIT_LINE
            if (style === 1) return 0xAAAA;          // DOTTED_LINE
            if (style === 2) return 0xFF18;          // CENTER_LINE
            if (style === 3) return 0xF0F0;          // DASHED_LINE
            return 0xFFFF;                           // SOLID_LINE
        },

        patFor: function (pidx, uptr) {
            if (pidx === 12 && uptr) {               // USER_FILL
                var a = [];
                for (var i = 0; i < 8; i++) a.push(HEAPU8[uptr + i]);
                return a;
            }
            return this.FILLPATS[pidx - 2] || this.FILLPATS[0];
        },

        setPix: function (x, y, c) {
            if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
            this.pix[y * this.w + x] = c;
            this.setPixRgba(x, y, c);
        },

        setPixRgba: function (x, y, c) {
            var o = (y * this.w + x) * 4, rgb = this.rgb(c);
            this.rgba[o] = (rgb >> 16) & 255;
            this.rgba[o + 1] = (rgb >> 8) & 255;
            this.rgba[o + 2] = rgb & 255;
            this.rgba[o + 3] = 255;
            this.dirty = true;
        },

        // plan §4: flush ~60 fps OR every 4 000 draw calls, whichever first,
        // so programs with no delay() still animate while huge putpixel loops
        // don't drown the postMessage channel.
        maybeFlush: function () {
            this.calls++;
            if (this.calls >= 4000) {
                this.calls = 0;
                this.flush();
            }
        },

        stamp: function (x, y, c, thick, horiz) {
            this.setPix(x, y, c);
            for (var i = 1; i < thick; i++) {
                if (horiz) this.setPix(x, y + i, c); else this.setPix(x + i, y, c);
            }
        },

        hlinePat: function (x1, x2, y, fc, pidx, uptr) {
            if (y < 0 || y >= this.h) return;
            if (x1 < 0) x1 = 0;
            if (x2 >= this.w) x2 = this.w - 1;
            if (x1 > x2) return;
            if (pidx === 0) return;                  // EMPTY_FILL: bg shows through
            if (pidx === 1) {                        // SOLID_FILL
                for (var x = x1; x <= x2; x++) this.setPix(x, y, fc);
                return;
            }
            var row = this.patFor(pidx, uptr)[y & 7];
            for (var x = x1; x <= x2; x++) {
                if ((row >> (7 - (x & 7))) & 1) this.setPix(x, y, fc);
            }
        },

        init: function (w, h) {
            this.w = w | 0; this.h = h | 0;
            this.pix = new Int32Array(this.w * this.h);
            this.rgba = new Uint8ClampedArray(this.w * this.h * 4);
            this.texts = [];
            this.dirty = true;
            this.calls = 0;
            var self = this;
            if (!this.installed) {
                this.installed = true;
                onmessage = function (e) {
                    var d = e.data || {};
                    if (d.type === 'key') {
                        if (self.keyWake) { var wake = self.keyWake; self.keyWake = null; wake(d.key); }
                        else self.pendingKey = d.key;
                    }
                };
            }
            if (!this.timer) this.timer = setInterval(function () { self.flush(); }, 16);
            postMessage({ type: 'canvas', w: this.w, h: this.h });
        },

        flush: function () {
            if (!this.dirty) return;
            this.dirty = false;
            postMessage({
                type: 'frame',
                rgba: this.rgba.slice(0),
                w: this.w, h: this.h,
                texts: this.texts
            });
            this.texts = [];
        }
    },

    js_initcanvas__deps: ['$CGI'],
    js_initcanvas: function (w, h) { CGI.init(w, h); },

    js_putpixel__deps: ['$CGI'],
    js_putpixel: function (x, y, c) { CGI.setPix(x, y, c); CGI.maybeFlush(); },

    js_line__deps: ['$CGI'],
    js_line: function (x1, y1, x2, y2, c, style, upat, thick) {
        x1 |= 0; y1 |= 0; x2 |= 0; y2 |= 0;
        var dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1);
        var sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
        var err = dx + dy, t = 0, x = x1, y = y1;
        var mask = CGI.lineMask(style, upat);
        var horiz = dx >= -dy;
        for (; ;) {
            if ((mask >>> (t & 15)) & 1) CGI.stamp(x, y, c, thick, horiz);
            if (x === x2 && y === y2) break;
            var e2 = 2 * err;
            if (e2 >= dy) { err += dy; x += sx; }
            if (e2 <= dx) { err += dx; y += sy; }
            t++;
        }
    },

    js_circle__deps: ['$CGI'],
    js_circle: function (x, y, r, c, style, upat, thick) {
        if (r < 0) return;
        if (r === 0) { CGI.setPix(x, y, c); return; }
        var mask = CGI.lineMask(style, upat);
        var n = Math.ceil(2 * Math.PI * r * 1.25); if (n < 16) n = 16;
        for (var i = 0; i < n; i++) {
            if (!((mask >>> (i & 15)) & 1)) continue;
            var a = 2 * Math.PI * i / n;
            CGI.stamp(x + Math.round(r * Math.cos(a)), y + Math.round(r * Math.sin(a)),
                      c, thick, true);
        }
    },

    js_ellipse__deps: ['$CGI'],
    js_ellipse: function (x, y, st, en, xr, yr, c, style, upat, thick) {
        if (xr < 0 || yr < 0) return;
        var a0 = st * Math.PI / 180, a1 = en * Math.PI / 180;
        if (a1 <= a0) a1 += 2 * Math.PI;
        var span = a1 - a0;
        var n = Math.ceil((xr + yr) * span * 1.25); if (n < 16) n = 16;
        var mask = CGI.lineMask(style, upat);
        for (var i = 0; i <= n; i++) {
            if (!((mask >>> (i & 15)) & 1)) continue;
            var a = a0 + span * i / n;
            CGI.stamp(x + Math.round(xr * Math.cos(a)), y - Math.round(yr * Math.sin(a)),
                      c, thick, true);
        }
    },

    js_bar__deps: ['$CGI'],
    js_bar: function (l, t, r, b, fc, pidx, uptr) {
        if (l > r) { var t1 = l; l = r; r = t1; }
        if (t > b) { var t2 = t; t = b; b = t2; }
        for (var y = t; y <= b; y++) CGI.hlinePat(l, r, y, fc, pidx, uptr);
    },

    js_fillellipse__deps: ['$CGI'],
    js_fillellipse: function (x, y, xr, yr, fc, pidx, uptr) {
        if (xr < 0 || yr < 0) return;
        if (yr === 0) { CGI.hlinePat(x - xr, x + xr, y, fc, pidx, uptr); return; }
        for (var dy = -yr; dy <= yr; dy++) {
            var dx = Math.floor(xr * Math.sqrt(Math.max(0, 1 - (dy * dy) / (yr * yr))));
            CGI.hlinePat(x - dx, x + dx, y + dy, fc, pidx, uptr);
        }
    },

    js_fillpoly__deps: ['$CGI'],
    js_fillpoly: function (n, ptr, fc, pidx, uptr) {
        if (n < 3 || !ptr) return;
        var xs = [], ys = [], base = ptr >> 2;
        for (var i = 0; i < n; i++) {
            xs.push(HEAP32[base + 2 * i]);
            ys.push(HEAP32[base + 2 * i + 1]);
        }
        var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
        for (var y = ymin; y <= ymax; y++) {
            var nodes = [], j = n - 1;
            for (var k = 0; k < n; k++) {
                if ((ys[k] < y && ys[j] >= y) || (ys[j] < y && ys[k] >= y))
                    nodes.push(xs[k] + (y - ys[k]) / (ys[j] - ys[k]) * (xs[j] - xs[k]));
                j = k;
            }
            nodes.sort(function (a, b) { return a - b; });
            for (var m = 0; m + 1 < nodes.length; m += 2)
                CGI.hlinePat(Math.round(nodes[m]), Math.round(nodes[m + 1]), y, fc, pidx, uptr);
        }
    },

    js_floodfill__deps: ['$CGI'],
    js_floodfill: function (x, y, border, fc, pidx, uptr) {
        x |= 0; y |= 0;
        if (x < 0 || y < 0 || x >= CGI.w || y >= CGI.h) return;
        var W = CGI.w, H = CGI.h, pix = CGI.pix;
        var target = pix[y * W + x];
        if (target === border || target === fc) return;
        var stack = [y * W + x];
        while (stack.length) {
            var p = stack.pop();
            if (pix[p] !== target) continue;
            var px = p % W, py = (p / W) | 0;
            pix[p] = fc;                             // mark + getpixel semantic
            if (pidx === 1 || pidx === 0) CGI.setPixRgba(px, py, fc);
            else {
                var row = CGI.patFor(pidx, uptr)[py & 7];
                if ((row >> (7 - (px & 7))) & 1) CGI.setPixRgba(px, py, fc);
            }
            if (px > 0) stack.push(p - 1);
            if (px < W - 1) stack.push(p + 1);
            if (py > 0) stack.push(p - W);
            if (py < H - 1) stack.push(p + W);
        }
        CGI.dirty = true;
    },

    js_getpixel__deps: ['$CGI'],
    js_getpixel: function (x, y) {
        x |= 0; y |= 0;
        if (x < 0 || y < 0 || x >= CGI.w || y >= CGI.h) return -1;
        return CGI.pix[y * CGI.w + x];
    },

    js_clear__deps: ['$CGI'],
    js_clear: function (c) {
        CGI.pix.fill(c);
        var rgb = CGI.rgb(c), r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
        var n = CGI.rgba.length;
        for (var i = 0; i < n; i += 4) {
            CGI.rgba[i] = r; CGI.rgba[i + 1] = g; CGI.rgba[i + 2] = b; CGI.rgba[i + 3] = 255;
        }
        CGI.texts = [];
        CGI.dirty = true;
        postMessage({ type: 'clear' });
    },

    js_outtextxy__deps: ['$CGI'],
    js_outtextxy: function (x, y, sptr, c, cs, hj, vj) {
        var s = '', p = sptr, b;
        while ((b = HEAPU8[p]) !== 0) {          // decode UTF-8 manually (BMP)
            if (b < 0x80) { s += String.fromCharCode(b); p += 1; }
            else if (b < 0xE0) {
                s += String.fromCharCode(((b & 0x1F) << 6) | (HEAPU8[p + 1] & 0x3F)); p += 2;
            } else {
                s += String.fromCharCode(((b & 0x0F) << 12) | ((HEAPU8[p + 1] & 0x3F) << 6)
                                         | (HEAPU8[p + 2] & 0x3F)); p += 3;
            }
        }
        if (!s) return 0;
        CGI.texts.push({ x: x, y: y, t: s, c: CGI.rgb(c), cs: cs, hj: hj, vj: vj });
        CGI.dirty = true;
        CGI.maybeFlush();
        return s.length * 8 * cs;
    },

    js_delay__deps: ['$CGI', '$Asyncify'],
    js_delay__async: true,
    js_delay: function (ms) {
        CGI.flush();
        if (ms <= 0 || Module['fast']) return;
        Asyncify.handleSleep(function (wake) { setTimeout(wake, ms); });
    },

    js_getch__deps: ['$CGI', '$Asyncify'],
    js_getch__async: true,
    js_getch: function () {
        CGI.flush();
        return Asyncify.handleSleep(function (wake) {
            if (CGI.pendingKey !== null) {
                var k = CGI.pendingKey; CGI.pendingKey = null;
                setTimeout(function () { wake(k); }, 0);
            } else CGI.keyWake = wake;
        });
    },

    js_kbhit__deps: ['$CGI'],
    js_kbhit: function () { return CGI.pendingKey !== null ? 1 : 0; },

    js_flush__deps: ['$CGI'],
    js_flush: function () { CGI.flush(); },
};

mergeInto(LibraryManager.library, LibraryGraphics);
