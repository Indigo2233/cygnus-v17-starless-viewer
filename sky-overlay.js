/* Sky overlay: TAN WCS, Cygnus stick figure, catalog DSOs, RA/Dec grid. */
(function () {
    var IMAGE_W = 55622;
    var IMAGE_H = 46752;
    var D2R = Math.PI / 180;
    var R2D = 180 / Math.PI;

    var sky = {
        grid: true,
        constellations: true,
        labels: true
    };
    var data = null;
    var wcs = null;
    var canvas = null;
    var ctx = null;
    var pointer = null;
    var dsoTiles = null;
    var dsoCache = {};
    var dsoPending = {};
    var tileTimer = 0;
    var FOV_L1 = 11;
    var FOV_L2 = 5.5;

    var PALETTE = {
        neb: { stroke: "rgba(255,168,186,0.32)", fill: "rgba(255,130,160,0.03)" },
        dark: { stroke: "rgba(190,200,218,0.22)", fill: "rgba(170,180,200,0.025)" },
        oc: { stroke: "rgba(236,214,140,0.34)", fill: "rgba(240,210,120,0.03)" },
        pn: { stroke: "rgba(130,230,200,0.34)", fill: "rgba(90,220,180,0.03)" },
        gc: { stroke: "rgba(255,186,120,0.32)", fill: "rgba(255,170,100,0.03)" }
    };

    function loadPrefs() {
        try {
            var raw = localStorage.getItem("cygnusSkyOverlay");
            if (!raw) return;
            var parsed = JSON.parse(raw);
            if (typeof parsed.grid === "boolean") sky.grid = parsed.grid;
            if (typeof parsed.constellations === "boolean") sky.constellations = parsed.constellations;
            if (typeof parsed.labels === "boolean") sky.labels = parsed.labels;
        } catch (e) {}
    }

    function savePrefs() {
        localStorage.setItem("cygnusSkyOverlay", JSON.stringify(sky));
    }

    function makeWcs(spec) {
        var pc = spec.pc;
        var crpix = spec.crpix;
        var crval = spec.crval;
        var det = pc[0][0] * pc[1][1] - pc[0][1] * pc[1][0];
        var inv = [
            [pc[1][1] / det, -pc[0][1] / det],
            [-pc[1][0] / det, pc[0][0] / det]
        ];
        var ra0 = crval[0] * D2R;
        var dec0 = crval[1] * D2R;
        return {
            pix2world: function (x, y) {
                var dx = x - (crpix[0] - 1);
                var dy = y - (crpix[1] - 1);
                var xi = (pc[0][0] * dx + pc[0][1] * dy) * D2R;
                var eta = (pc[1][0] * dx + pc[1][1] * dy) * D2R;
                var rho2 = xi * xi + eta * eta;
                if (rho2 < 1e-30) {
                    return [crval[0], crval[1]];
                }
                var rho = Math.sqrt(rho2);
                var c = Math.atan(rho);
                var sinc = Math.sin(c);
                var cosc = Math.cos(c);
                var ra = ra0 + Math.atan2(
                    xi * sinc,
                    rho * Math.cos(dec0) * cosc - eta * Math.sin(dec0) * sinc
                );
                var dec = Math.asin(cosc * Math.sin(dec0) + eta * sinc * Math.cos(dec0) / rho);
                ra = ra * R2D % 360;
                if (ra < 0) ra += 360;
                return [ra, dec * R2D];
            },
            world2pix: function (ra, dec) {
                ra *= D2R;
                dec *= D2R;
                var dra = ra - ra0;
                var cosc = Math.sin(dec0) * Math.sin(dec) +
                    Math.cos(dec0) * Math.cos(dec) * Math.cos(dra);
                if (cosc <= 0.05) return null;
                var xi = Math.cos(dec) * Math.sin(dra) / cosc * R2D;
                var eta = (Math.cos(dec0) * Math.sin(dec) -
                    Math.sin(dec0) * Math.cos(dec) * Math.cos(dra)) / cosc * R2D;
                var dx = inv[0][0] * xi + inv[0][1] * eta;
                var dy = inv[1][0] * xi + inv[1][1] * eta;
                return [dx + (crpix[0] - 1), dy + (crpix[1] - 1)];
            }
        };
    }

    function imageToScreen(x, y) {
        var pt = viewer.viewport.imageToViewerElementCoordinates(
            new OpenSeadragon.Point(x, y)
        );
        return [pt.x, pt.y];
    }

    function screenToImage(sx, sy) {
        var pt = viewer.viewport.viewerElementToImageCoordinates(
            new OpenSeadragon.Point(sx, sy)
        );
        return [pt.x, pt.y];
    }

    function fovDeg() {
        var bounds = viewer.viewport.getBounds(true);
        return bounds.width * IMAGE_W * 1.25005 / 3600;
    }

    function formatRa(deg) {
        var hours = deg / 15;
        if (hours < 0) hours += 24;
        var h = Math.floor(hours);
        var m = (hours - h) * 60;
        if (m >= 59.95) {
            m = 0;
            h = (h + 1) % 24;
        }
        if (fovDeg() < 2) {
            var s = (m - Math.floor(m)) * 60;
            return h + "h " + pad2(Math.floor(m)) + "m " + pad2(Math.round(s)) + "s";
        }
        return h + "h " + m.toFixed(m < 10 ? 1 : 0) + "m";
    }

    function formatDec(deg) {
        var sign = deg >= 0 ? "+" : "−";
        var a = Math.abs(deg);
        var d = Math.floor(a);
        var m = (a - d) * 60;
        if (m >= 59.5) {
            m = 0;
            d += 1;
        }
        if (fovDeg() < 2) {
            return sign + d + "° " + pad2(Math.round(m)) + "′";
        }
        return sign + d + "°";
    }

    function pad2(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function niceStep(fov) {
        var steps = [15, 10, 5, 2, 1, 0.5, 1 / 6, 1 / 12, 1 / 30, 1 / 60];
        for (var i = 0; i < steps.length; i++) {
            if (fov / steps[i] <= 8) return steps[i];
        }
        return steps[steps.length - 1];
    }

    function wrapRa(ra) {
        ra %= 360;
        return ra < 0 ? ra + 360 : ra;
    }

    function resizeCanvas() {
        if (!canvas) return;
        var dpr = window.devicePixelRatio || 1;
        var w = canvas.clientWidth;
        var h = canvas.clientHeight;
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function visibleSky() {
        var el = viewer.container;
        var w = el.clientWidth;
        var h = el.clientHeight;
        var ras = [];
        var decs = [];
        var corners = [[0, 0], [w, 0], [w, h], [0, h], [w / 2, h / 2]];
        for (var i = 0; i < corners.length; i++) {
            var img = screenToImage(corners[i][0], corners[i][1]);
            var skyPos = wcs.pix2world(img[0], img[1]);
            ras.push(skyPos[0]);
            decs.push(skyPos[1]);
        }
        var raMin = Math.min.apply(null, ras);
        var raMax = Math.max.apply(null, ras);
        if (raMax - raMin > 180) {
            ras = ras.map(function (r) { return r < 180 ? r + 360 : r; });
            raMin = Math.min.apply(null, ras);
            raMax = Math.max.apply(null, ras);
        }
        return {
            ra0: raMin - 0.5,
            ra1: raMax + 0.5,
            dec0: Math.min.apply(null, decs) - 0.5,
            dec1: Math.max.apply(null, decs) + 0.5
        };
    }

    function sampleSkyLine(ra0, dec0, ra1, dec1, samples) {
        var pts = [];
        for (var i = 0; i <= samples; i++) {
            var t = i / samples;
            var pix = wcs.world2pix(wrapRa(ra0 + (ra1 - ra0) * t),
                dec0 + (dec1 - dec0) * t);
            if (!pix) continue;
            pts.push(imageToScreen(pix[0], pix[1]));
        }
        return pts;
    }

    function strokePoints(pts) {
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
    }

    function edgeAnchor(pts, side) {
        var w = canvas.clientWidth;
        var h = canvas.clientHeight;
        var best = null;
        var bestScore = 1e9;
        for (var i = 0; i < pts.length; i++) {
            var x = pts[i][0];
            var y = pts[i][1];
            if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
            var score = side === "bottom" ? Math.abs(h - 22 - y) : Math.abs(18 - x);
            if (score < bestScore) {
                bestScore = score;
                best = pts[i];
            }
        }
        return best;
    }

    function haloText(text, x, y) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = 4;
        ctx.fillText(text, x, y);
        ctx.restore();
        ctx.fillText(text, x, y);
    }

    function drawGrid() {
        var box = visibleSky();
        var step = niceStep(fovDeg());
        var raStart = Math.floor(box.ra0 / step) * step;
        var decStart = Math.floor(box.dec0 / step) * step;
        ctx.lineWidth = 0.55;
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.fillStyle = "rgba(255,255,255,0.34)";
        ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
        var ra, dec, pts, anchor;
        for (ra = raStart; ra <= box.ra1 + 1e-9; ra += step) {
            pts = sampleSkyLine(ra, box.dec0, ra, box.dec1, 28);
            strokePoints(pts);
            anchor = edgeAnchor(pts, "bottom");
            if (anchor) {
                ctx.textAlign = "center";
                haloText(formatRa(wrapRa(ra)), anchor[0], canvas.clientHeight - 14);
            }
        }
        for (dec = decStart; dec <= box.dec1 + 1e-9; dec += step) {
            pts = sampleSkyLine(box.ra0, dec, box.ra1, dec, 28);
            strokePoints(pts);
            anchor = edgeAnchor(pts, "left");
            if (anchor) {
                ctx.textAlign = "left";
                haloText(formatDec(dec), 10, anchor[1] + 3);
            }
        }
    }

    function drawConstellations() {
        if (!data) return;
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.lineWidth = 0.9;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        data.constellations.forEach(function (cst) {
            cst.lines.forEach(function (line) {
                ctx.beginPath();
                for (var i = 0; i < line.length; i++) {
                    var scr = imageToScreen(line[i][0], line[i][1]);
                    if (i === 0) ctx.moveTo(scr[0], scr[1]);
                    else ctx.lineTo(scr[0], scr[1]);
                }
                ctx.stroke();
            });
            if (!cst.label) return;
            var p = imageToScreen(cst.label[0], cst.label[1]);
            ctx.font = "500 12px ui-sans-serif, system-ui, sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.26)";
            ctx.textAlign = "center";
            haloText((cst.name || "Cyg").toUpperCase(), p[0], p[1] - 10);
        });
    }

    function imageScale() {
        if (typeof screenPixelsPerImagePixel === "function") {
            return screenPixelsPerImagePixel();
        }
        var a = imageToScreen(0, 0);
        var b = imageToScreen(1000, 0);
        return Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000;
    }

    function drawEllipse(obj, scr, scale) {
        var limit = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.42;
        var rx = obj.a * scale;
        var ry = obj.b * scale;
        var maxR = Math.max(rx, ry);
        if (maxR > limit && maxR > 0) {
            var f = limit / maxR;
            rx *= f;
            ry *= f;
        }
        if (rx < 5 && ry < 5) return false;
        var pal = PALETTE[obj.kind] || PALETTE.neb;
        var huge = obj.a * scale > limit * 1.15;
        ctx.save();
        ctx.translate(scr[0], scr[1]);
        ctx.rotate(obj.rot || 0);
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(rx, 4), Math.max(ry, 3), 0, 0, Math.PI * 2);
        if (obj.kind === "dark") ctx.setLineDash([5, 5]);
        ctx.fillStyle = huge ? "rgba(0,0,0,0)" : pal.fill;
        ctx.strokeStyle = pal.stroke;
        ctx.lineWidth = huge ? 0.7 : 0.85;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        return Math.max(rx, ry);
    }

    function visibleImageBox(pad) {
        var w = canvas.clientWidth;
        var h = canvas.clientHeight;
        var corners = [[0, 0], [w, 0], [w, h], [0, h]];
        var xs = [];
        var ys = [];
        for (var i = 0; i < corners.length; i++) {
            var p = screenToImage(corners[i][0], corners[i][1]);
            xs.push(p[0]);
            ys.push(p[1]);
        }
        pad = pad || 2800;
        return {
            x0: Math.min.apply(null, xs) - pad,
            y0: Math.min.apply(null, ys) - pad,
            x1: Math.max.apply(null, xs) + pad,
            y1: Math.max.apply(null, ys) + pad
        };
    }

    function tileKeysForBox(box, neighbors) {
        if (!dsoTiles) return [];
        var size = dsoTiles.size || 8192;
        var cols = dsoTiles.cols || 1;
        var rows = dsoTiles.rows || 1;
        var c0 = Math.max(0, Math.floor(box.x0 / size) - (neighbors ? 1 : 0));
        var r0 = Math.max(0, Math.floor(box.y0 / size) - (neighbors ? 1 : 0));
        var c1 = Math.min(cols - 1, Math.floor(box.x1 / size) + (neighbors ? 1 : 0));
        var r1 = Math.min(rows - 1, Math.floor(box.y1 / size) + (neighbors ? 1 : 0));
        var keys = [];
        for (var c = c0; c <= c1; c++) {
            for (var r = r0; r <= r1; r++) keys.push(c + "_" + r);
        }
        return keys;
    }

    function tileFileSet(level) {
        var lv = dsoTiles && dsoTiles.levels && dsoTiles.levels[String(level)];
        var set = {};
        if (!lv || !lv.files) return set;
        for (var i = 0; i < lv.files.length; i++) set[lv.files[i]] = 1;
        return set;
    }

    function loadTile(level, name) {
        var key = level + ":" + name;
        if (dsoCache[key] || dsoPending[key]) return;
        var files = tileFileSet(level);
        if (!files[name]) {
            dsoCache[key] = [];
            return;
        }
        dsoPending[key] = 1;
        fetch("sky-dso/" + level + "/" + name + ".json")
            .then(function (r) { return r.ok ? r.json() : { objects: [] }; })
            .then(function (json) {
                dsoCache[key] = json.objects || [];
                delete dsoPending[key];
                draw();
            })
            .catch(function () {
                dsoCache[key] = [];
                delete dsoPending[key];
            });
    }

    function activeLevels(fov) {
        var levels = [];
        if (fov <= FOV_L1) levels.push(1);
        if (fov <= FOV_L2) levels.push(2);
        return levels;
    }

    function ensureTiles(neighbors) {
        if (!sky.labels || !dsoTiles || !viewer.world || viewer.world.getItemCount() === 0) return;
        var levels = activeLevels(fovDeg());
        if (!levels.length) return;
        var keys = tileKeysForBox(visibleImageBox(2800), !!neighbors);
        for (var i = 0; i < levels.length; i++) {
            for (var k = 0; k < keys.length; k++) loadTile(levels[i], keys[k]);
        }
    }

    function queueTiles(delay) {
        if (tileTimer) {
            clearTimeout(tileTimer);
            tileTimer = 0;
        }
        if (delay <= 0) {
            ensureTiles(true);
            return;
        }
        tileTimer = setTimeout(function () {
            tileTimer = 0;
            ensureTiles(false);
        }, delay);
    }

    function loadedDsos() {
        var list = (data && data.objects) ? data.objects.slice() : [];
        if (!dsoTiles) return list;
        var levels = activeLevels(fovDeg());
        if (!levels.length) return list;
        var keys = tileKeysForBox(visibleImageBox(2800), false);
        for (var i = 0; i < levels.length; i++) {
            for (var k = 0; k < keys.length; k++) {
                var arr = dsoCache[levels[i] + ":" + keys[k]];
                if (!arr || !arr.length) continue;
                for (var j = 0; j < arr.length; j++) list.push(arr[j]);
            }
        }
        return list;
    }

    function drawLabels() {
        if (!data) return;
        var zoom = fovDeg();
        var scale = imageScale();
        var shown = [];
        var w = canvas.clientWidth;
        var h = canvas.clientHeight;

        (loadedDsos() || []).forEach(function (obj) {
            if (obj.zoom === 1 && zoom > FOV_L1) return;
            if (obj.zoom === 2 && zoom > FOV_L2) return;
            var scr = imageToScreen(obj.x, obj.y);
            if (scr[0] < -80 || scr[1] < -80 || scr[0] > w + 80 || scr[1] > h + 80) return;
            var size = drawEllipse(obj, scr, scale);
            if (size === false) return;
            var showName = size >= 22 || obj.cat === "M" || obj.zoom === 0 ||
                (obj.cat === "NGC" && size >= 16);
            if (!showName) return;
            var collide = shown.some(function (q) {
                return Math.abs(q[0] - scr[0]) < 70 && Math.abs(q[1] - scr[1]) < 14;
            });
            if (collide) return;
            shown.push(scr);
            ctx.font = "500 11px ui-sans-serif, system-ui, 'Segoe UI', sans-serif";
            ctx.textAlign = "center";
            ctx.fillStyle = "rgba(255,255,255,0.68)";
            haloText(obj.id, scr[0], scr[1] - size - 6);
        });

        (data.stars || []).forEach(function (obj) {
            if (obj.zoom === 1 && zoom > 12) return;
            if (obj.zoom === 2 && zoom > 6) return;
            var scr = imageToScreen(obj.x, obj.y);
            if (scr[0] < -10 || scr[1] < -10 || scr[0] > w + 10 || scr[1] > h + 10) return;
            ctx.beginPath();
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.arc(scr[0], scr[1], 1.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "left";
            ctx.fillStyle = "rgba(255,255,255,0.52)";
            haloText(obj.id, scr[0] + 7, scr[1] - 4);
        });
    }

    function draw() {
        if (!ctx || !wcs || !viewer.world || viewer.world.getItemCount() === 0) return;
        var w = canvas.clientWidth;
        var h = canvas.clientHeight;
        ctx.clearRect(0, 0, w, h);
        if (!sky.grid && !sky.constellations && !sky.labels) return;
        if (sky.grid) drawGrid();
        if (sky.labels) drawLabels();
        if (sky.constellations) drawConstellations();
        if (pointer) {
            ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "left";
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            haloText(formatRa(pointer[0]) + "    " + formatDec(pointer[1]), 12, h - 42);
        }
    }

    function bindUi() {
        var btn = document.getElementById("skyBtn");
        var panel = document.getElementById("skyPanel");
        var grid = document.getElementById("skyGrid");
        var cst = document.getElementById("skyCst");
        var lab = document.getElementById("skyLab");
        grid.checked = sky.grid;
        cst.checked = sky.constellations;
        lab.checked = sky.labels;
        btn.classList.toggle("on", sky.grid || sky.constellations || sky.labels);
        btn.addEventListener("click", function () {
            panel.classList.toggle("hidden");
            var open = !panel.classList.contains("hidden");
            btn.classList.toggle("on", open || sky.grid || sky.constellations || sky.labels);
            if (open) {
                document.getElementById("compPanel").classList.add("hidden");
                document.getElementById("compBtn").classList.remove("on");
            }
        });
        function sync() {
            sky.grid = grid.checked;
            sky.constellations = cst.checked;
            sky.labels = lab.checked;
            savePrefs();
            btn.classList.toggle("on", !panel.classList.contains("hidden") ||
                sky.grid || sky.constellations || sky.labels);
            if (sky.labels) queueTiles(0);
            draw();
        }
        grid.addEventListener("change", sync);
        cst.addEventListener("change", sync);
        lab.addEventListener("change", sync);
        document.getElementById("compBtn").addEventListener("click", function () {
            if (!document.getElementById("compPanel").classList.contains("hidden")) {
                panel.classList.add("hidden");
            }
        });
        viewer.container.addEventListener("mousemove", function (ev) {
            var rect = viewer.container.getBoundingClientRect();
            var img = screenToImage(ev.clientX - rect.left, ev.clientY - rect.top);
            pointer = wcs.pix2world(img[0], img[1]);
            draw();
        });
        viewer.container.addEventListener("mouseleave", function () {
            pointer = null;
            draw();
        });
    }

    loadPrefs();
    canvas = document.getElementById("skyCanvas");
    ctx = canvas.getContext("2d");

    fetch("sky-data.json")
        .then(function (r) { return r.json(); })
        .then(function (json) {
            data = json;
            IMAGE_W = json.width;
            IMAGE_H = json.height;
            wcs = makeWcs(json.wcs);
            dsoTiles = json.dsoTiles || null;
            if (dsoTiles && dsoTiles.levels) {
                if (dsoTiles.levels["1"] && dsoTiles.levels["1"].maxFov) {
                    FOV_L1 = dsoTiles.levels["1"].maxFov;
                }
                if (dsoTiles.levels["2"] && dsoTiles.levels["2"].maxFov) {
                    FOV_L2 = dsoTiles.levels["2"].maxFov;
                }
            }
            bindUi();
            resizeCanvas();
            queueTiles(0);
            draw();
        });

    viewer.addHandler("animation", function () {
        draw();
        queueTiles(140);
    });
    viewer.addHandler("animation-finish", function () {
        draw();
        queueTiles(0);
    });
    viewer.addHandler("open", function () {
        resizeCanvas();
        queueTiles(0);
        draw();
    });
    viewer.addHandler("resize", function () {
        resizeCanvas();
        queueTiles(80);
        draw();
    });
    window.addEventListener("resize", function () {
        resizeCanvas();
        draw();
    });
})();
