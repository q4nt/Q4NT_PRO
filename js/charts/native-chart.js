/* ==========================================================================
   Q4NT PRO -- NativeChart (TradingView-style Candlestick Renderer)
   Renders mock SPY candle data on a fullscreen HTML5 Canvas with:
     - Horizontal drag-to-pan (left-click)
     - Scroll-wheel zoom on time axis (X)
     - Auto-fit Y-axis to visible price range
     - Crosshair + OHLC tooltip on hover
     - Price axis (right) and time axis (bottom)
   ========================================================================== */

class NativeChart {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

        // Data
        this.candles = [];

        // Viewport: defines which candle range is visible
        this.visibleStart = 0;        // leftmost visible candle index (float)
        this.visibleCount = 400;      // number of candles visible on screen
        this.ticker = 'ABCD';         // Ticker watermark

        // Zoom constraints
        this.minVisibleCandles = 10;
        this.maxVisibleCandles = 2000;

        // Margins for axes
        this.marginRight  = 48;   // right price axis width
        this.marginBottom = 28;   // time axis height
        this.marginTop    = 12;
        this.marginLeft   = 48;   // left price axis width (changed from 4 to show left axis)

        // Interaction state
        this.isDragging = false;
        this.dragType = 'pan'; // 'pan', 'scaleX', 'scaleY'
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragStartVisibleStart = 0;
        this.dragStartVisibleCount = 0;
        this.dragStartVisMin = 0;
        this.dragStartVisMax = 0;
        this.autoFitY = true;

        // Crosshair
        this.mouseX = -1;
        this.mouseY = -1;
        this.showCrosshair = false;

        // Cached price range for the visible window
        this._visMin = 0;
        this._visMax = 1;

        // Visual Toggles
        this.showGrid = true;
        this.showAxes = true;
        this.chartFontSize = 11;

        // Drawing Tools
        this.activeDrawTool = null; // 'line', 'rect', 'text', 'percent'
        this.drawingState = 0;      // 0 = idle, 1 = first point set
        this.currentDrawing = null;
        this.drawings = [];
        
        this.hoveredDrawing = null;
        this.hoveredPoint = null;
        this.draggingDrawing = null;
        this.draggingPoint = null;

        if (this.canvas) {
            this._bindEvents();
            this.resize();
            this._resizeBound = () => this.resize();
            window.addEventListener('resize', this._resizeBound);
            
            // Auto-shift/resize when parent container size changes (e.g. side panels collapse/expand)
            if (window.ResizeObserver) {
                this._resizeObserver = new ResizeObserver(this._resizeBound);
                this._resizeObserver.observe(this.canvas.parentElement || this.canvas);
            }

            // Continuously check panel sizes to adjust margins smoothly during animations
            this._animFrame = 0;
            this._animLoop = () => {
                if (!this.canvas) return;
                this._animFrame++;
                // Check dimensions every 2nd frame to save performance while maintaining smoothness
                if (this._animFrame % 2 === 0) {
                    if (this._checkDimensions()) {
                        this.render();
                    }
                }
                this._animId = requestAnimationFrame(this._animLoop);
            };
            this._animId = requestAnimationFrame(this._animLoop);
        }
    }

    // ------------------------------------------------------------------
    // Dynamic Margins
    // ------------------------------------------------------------------
    _checkDimensions() {
        if (!this.canvas) return false;
        
        let leftWidth = 0;
        let rightWidth = 0;
        let bottomHeight = 0;

        const W = window.innerWidth;
        const H = window.innerHeight;

        // Left panels
        document.querySelectorAll('.ai-edge-left, .toolbar-left').forEach(p => {
            const style = getComputedStyle(p);
            if (style.opacity === '0' || style.display === 'none') return;
            const r = p.getBoundingClientRect();
            if (r.right > 0 && r.width > 0) {
                leftWidth = Math.max(leftWidth, r.right);
            }
        });

        // Right panels
        document.querySelectorAll('.ai-edge-right, .toolbar-right').forEach(p => {
            const style = getComputedStyle(p);
            if (style.opacity === '0' || style.display === 'none') return;
            const r = p.getBoundingClientRect();
            if (r.left < W && r.width > 0) {
                rightWidth = Math.max(rightWidth, W - r.left);
            }
        });

        // Bottom panels
        document.querySelectorAll('.bottom-tab-panel').forEach(p => {
            const style = getComputedStyle(p);
            if (style.opacity === '0' || style.display === 'none') return;
            const r = p.getBoundingClientRect();
            if (r.top < H && r.height > 0) {
                bottomHeight = Math.max(bottomHeight, H - r.top);
            }
        });

        const newML = Math.max(48, leftWidth + 48);
        const newMR = Math.max(48, rightWidth + 48);
        const newMB = Math.max(28, bottomHeight + 28);

        let changed = false;
        if (Math.abs(this.marginLeft - newML) > 0.5) { this.marginLeft = newML; changed = true; }
        if (Math.abs(this.marginRight - newMR) > 0.5) { this.marginRight = newMR; changed = true; }
        if (Math.abs(this.marginBottom - newMB) > 0.5) { this.marginBottom = newMB; changed = true; }

        return changed;
    }

    // ------------------------------------------------------------------
    // Data Generation
    // ------------------------------------------------------------------
    generateMockData(numCandles = 2000) {
        this.candles = [];
        let currentPrice = 400;

        for (let i = 0; i < numCandles; i++) {
            const isSpike = Math.random() < 0.05;
            const volatility = isSpike ? 5.0 : 1.5;
            const drift = 0.05;

            const open = currentPrice;
            const change = (Math.random() - 0.5) * volatility + drift;
            const close = open + change;

            const highOffset = Math.random() * volatility * 0.8;
            const lowOffset  = Math.random() * volatility * 0.8;

            const high = Math.max(open, close) + highOffset;
            const low  = Math.min(open, close) - lowOffset;

            // Generate a fake volume
            const volume = Math.floor(Math.random() * 50000) + (isSpike ? 100000 : 0);

            // Generate a fake timestamp (1-minute bars starting from a base)
            const baseTime = new Date(2026, 0, 2, 9, 30).getTime();
            const timestamp = baseTime + i * 60000;

            this.candles.push({ open, high, low, close, volume, time: timestamp });
            currentPrice = close;
        }

        // Show the last visibleCount candles
        this.visibleStart = Math.max(0, this.candles.length - this.visibleCount);
        this.render();
    }

    // ------------------------------------------------------------------
    // Geometry Helpers
    // ------------------------------------------------------------------
    get chartLeft()   { return this.marginLeft; }
    get chartTop()    { return this.marginTop; }
    get chartWidth()  { return (this.canvas.clientWidth  - this.marginLeft - this.marginRight); }
    get chartHeight() { return (this.canvas.clientHeight - this.marginTop  - this.marginBottom); }
    get chartBottom() { return this.marginTop + this.chartHeight; }
    get chartRight()  { return this.marginLeft + this.chartWidth; }

    // Map candle index to pixel X (center of candle)
    _indexToX(idx) {
        const rel = idx - this.visibleStart;
        const candleW = this.chartWidth / this.visibleCount;
        return this.chartLeft + rel * candleW + candleW / 2;
    }

    // Map price to pixel Y
    _priceToY(price) {
        const range = this._visMax - this._visMin || 1;
        const ratio = (price - this._visMin) / range;
        return this.chartBottom - ratio * this.chartHeight;
    }

    // Map pixel X to candle index
    _xToIndex(px) {
        const candleW = this.chartWidth / this.visibleCount;
        return this.visibleStart + (px - this.chartLeft) / candleW;
    }

    // Map pixel Y to price
    _yToPrice(py) {
        const range = this._visMax - this._visMin || 1;
        const ratio = (this.chartBottom - py) / this.chartHeight;
        return this._visMin + ratio * range;
    }

    // ------------------------------------------------------------------
    // Compute visible price range (with 8% padding)
    // ------------------------------------------------------------------
    _computeVisibleRange() {
        if (!this.autoFitY) return; // Skip if manually scaled by user

        let lo = Infinity, hi = -Infinity;
        const s = Math.max(0, Math.floor(this.visibleStart));
        const e = Math.min(this.candles.length - 1, Math.ceil(this.visibleStart + this.visibleCount));

        let hasData = false;
        for (let i = s; i <= e; i++) {
            const c = this.candles[i];
            if (!c) continue;
            hasData = true;
            if (c.high > hi) hi = c.high;
            if (c.low  < lo) lo = c.low;
        }

        if (hasData) {
            const pad = (hi - lo) * 0.08 || 1;
            this._visMin = lo - pad;
            this._visMax = hi + pad;
        } else if (this._visMin === 0 && this._visMax === 1) {
            // Fallback if completely empty and no previous state
            if (this.candles.length > 0) {
                const last = this.candles[this.candles.length - 1].close;
                this._visMin = last - 10;
                this._visMax = last + 10;
            }
        }
        // If !hasData and we already have a previous _visMin/_visMax, we retain it to prevent the axis from collapsing to 0..1
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    _bindEvents() {
        const c = this.canvas;
        c.style.touchAction = 'none';

        // --- Pointer (drag to pan or scale) ---
        c.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const rect = c.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            if (this.activeDrawTool) {
                const px = this._xToIndex(mx);
                const py = this._yToPrice(my);

                if (this.drawingState === 0) {
                    this.currentDrawing = {
                        type: this.activeDrawTool,
                        p1: { x: px, y: py },
                        p2: { x: px, y: py }
                    };
                    this.drawingState = 1;
                } else if (this.drawingState === 1) {
                    this.currentDrawing.p2 = { x: px, y: py };
                    if (this.activeDrawTool === 'text') {
                        const txt = prompt('Enter text for chart:');
                        if (txt) {
                            this.currentDrawing.text = txt;
                            this.drawings.push(this.currentDrawing);
                        }
                    } else {
                        this.drawings.push(this.currentDrawing);
                    }
                    this.currentDrawing = null;
                    this.drawingState = 0;
                    this.activeDrawTool = null;
                    document.querySelectorAll('#tool-line, #tool-rect, #tool-text, #tool-percent').forEach(el => el.style.color = '');
                }
                this.render();
                return;
            }

            if (this.hoveredDrawing && this.hoveredPoint) {
                this.draggingDrawing = this.hoveredDrawing;
                this.draggingPoint = this.hoveredPoint;
                try { c.setPointerCapture(e.pointerId); } catch(_) {}
                return;
            }

            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.dragStartVisibleStart = this.visibleStart;
            this.dragStartVisibleCount = this.visibleCount;
            this.dragStartVisMin = this._visMin;
            this.dragStartVisMax = this._visMax;

            if (my > this.chartBottom) {
                this.dragType = 'scaleX';
                c.style.cursor = 'ew-resize';
            } else if (mx < this.chartLeft || mx > this.chartRight) {
                this.dragType = 'scaleY';
                c.style.cursor = 'ns-resize';
                this.autoFitY = false;
            } else {
                this.dragType = 'pan';
                c.style.cursor = 'grabbing';
            }

            try { c.setPointerCapture(e.pointerId); } catch(_) {}
        });

        c.addEventListener('pointermove', (e) => {
            const rect = c.getBoundingClientRect();
            this.mouseX = e.clientX - rect.left;
            this.mouseY = e.clientY - rect.top;

            if (this.activeDrawTool && this.drawingState === 1 && this.currentDrawing) {
                this.currentDrawing.p2 = { 
                    x: this._xToIndex(this.mouseX), 
                    y: this._yToPrice(this.mouseY) 
                };
                this.render();
                return;
            }

            if (this.draggingDrawing) {
                this.draggingDrawing[this.draggingPoint] = { 
                    x: this._xToIndex(this.mouseX), 
                    y: this._yToPrice(this.mouseY) 
                };
                // Invalidate cached measurements so they recalculate
                this.draggingDrawing._text = null;
                this.render();
                return;
            }

            if (this.isDragging) {
                const dx = e.clientX - this.dragStartX;
                const dy = e.clientY - this.dragStartY;

                if (this.dragType === 'pan') {
                    const candleW = this.chartWidth / this.visibleCount;
                    const shift = -dx / candleW;
                    let newStart = this.dragStartVisibleStart + shift;

                    // Clamp: don't pan past the data boundaries (allow 500 candles empty space in front)
                    const maxStart = this.candles.length > 0 ? this.candles.length + 500 - this.visibleCount : 0;
                    newStart = Math.max(0, Math.min(maxStart, newStart));
                    this.visibleStart = newStart;

                    // If user pans vertically, disable autoFitY so they can drag up and down freely
                    if (this.autoFitY && Math.abs(dy) > 5) {
                        this.autoFitY = false;
                    }

                    // Pan Y axis if auto-fit is off
                    if (!this.autoFitY) {
                        const range = this.dragStartVisMax - this.dragStartVisMin || 1;
                        const priceShift = (dy / this.chartHeight) * range;
                        this._visMin = this.dragStartVisMin + priceShift;
                        this._visMax = this.dragStartVisMax + priceShift;
                    }

                } else if (this.dragType === 'scaleX') {
                    const zoomFactor = Math.exp(-dx / 200);
                    let newCount = this.dragStartVisibleCount * zoomFactor;
                    newCount = Math.max(this.minVisibleCandles, Math.min(this.maxVisibleCandles, newCount));

                    const centerIdx = this.dragStartVisibleStart + this.dragStartVisibleCount / 2;
                    let newStart = centerIdx - newCount / 2;

                    const maxStart = this.candles.length > 0 ? this.candles.length + 500 - newCount : 0;
                    newStart = Math.max(0, Math.min(maxStart, newStart));
                    
                    this.visibleCount = newCount;
                    this.visibleStart = newStart;

                } else if (this.dragType === 'scaleY') {
                    const zoomFactor = Math.exp(dy / 200);
                    const range = this.dragStartVisMax - this.dragStartVisMin || 1;
                    const newRange = range * zoomFactor;
                    
                    const centerPrice = (this.dragStartVisMax + this.dragStartVisMin) / 2;
                    this._visMin = centerPrice - newRange / 2;
                    this._visMax = centerPrice + newRange / 2;
                }

                this.showCrosshair = false;
            } else {
                // Hit detection for drawing handles
                if (!this.activeDrawTool) {
                    this.hoveredDrawing = null;
                    this.hoveredPoint = null;
                    const hitRadius = 15; // px tolerance
                    for (let i = this.drawings.length - 1; i >= 0; i--) {
                        const d = this.drawings[i];
                        if (!d.p1 || !d.p2) continue;
                        
                        const px1 = this._indexToX(d.p1.x);
                        const py1 = this._priceToY(d.p1.y);
                        const px2 = this._indexToX(d.p2.x);
                        const py2 = this._priceToY(d.p2.y);

                        if (Math.hypot(this.mouseX - px1, this.mouseY - py1) < hitRadius) {
                            this.hoveredDrawing = d;
                            this.hoveredPoint = 'p1';
                            break;
                        }
                        if (Math.hypot(this.mouseX - px2, this.mouseY - py2) < hitRadius) {
                            this.hoveredDrawing = d;
                            this.hoveredPoint = 'p2';
                            break;
                        }
                    }
                }

                this.showCrosshair = (this.mouseX >= this.chartLeft && this.mouseX <= this.chartRight &&
                                      this.mouseY >= this.chartTop  && this.mouseY <= this.chartBottom);
                
                if (this.hoveredPoint) {
                    c.style.cursor = 'grab';
                } else if (this.mouseY > this.chartBottom) {
                    c.style.cursor = 'ew-resize';
                } else if (this.mouseX < this.chartLeft || this.mouseX > this.chartRight) {
                    c.style.cursor = 'ns-resize';
                } else {
                    c.style.cursor = 'crosshair';
                }
            }
            this.render();
        });

        const endDrag = (e) => {
            if (this.draggingDrawing) {
                this.draggingDrawing = null;
                this.draggingPoint = null;
                try { c.releasePointerCapture(e.pointerId); } catch(_) {}
                return;
            }
            if (this.isDragging) {
                this.isDragging = false;
                const rect = c.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                
                if (my > this.chartBottom) c.style.cursor = 'ew-resize';
                else if (mx < this.chartLeft || mx > this.chartRight) c.style.cursor = 'ns-resize';
                else c.style.cursor = 'crosshair';

                try { c.releasePointerCapture(e.pointerId); } catch(_) {}
            }
        };
        c.addEventListener('pointerup', endDrag);
        c.addEventListener('pointercancel', endDrag);

        c.addEventListener('dblclick', (e) => {
            const rect = c.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            // Double click on Y-axis resets autoFitY
            if (mx > this.chartRight || mx < this.chartLeft) {
                if (!this.autoFitY) {
                    this.autoFitY = true;
                    this.render();
                }
                return;
            }

            // Otherwise, auto zoom 5x to the clicked area
            const zoomFactor = 0.2; // Zoom in 5x
            const pivotIndex = this._xToIndex(mx);
            let newCount = this.visibleCount * zoomFactor;
            newCount = Math.max(this.minVisibleCandles, Math.min(this.maxVisibleCandles, newCount));

            const fractionX = (mx - this.chartLeft) / this.chartWidth;
            let newStart = pivotIndex - fractionX * newCount;
            const maxStart = this.candles.length > 0 ? this.candles.length + 500 - newCount : 0;
            newStart = Math.max(0, Math.min(maxStart, newStart));

            this.visibleCount = newCount;
            this.visibleStart = newStart;

            // Zoom Y
            this.autoFitY = false;
            const pivotPrice = this._yToPrice(my);
            const range = this._visMax - this._visMin || 1;
            const newRange = range * zoomFactor;
            
            const fractionY = (this.chartBottom - my) / this.chartHeight;
            this._visMin = pivotPrice - fractionY * newRange;
            this._visMax = pivotPrice + (1 - fractionY) * newRange;

            this.render();
        });

        c.addEventListener('pointerleave', () => {
            this.showCrosshair = false;
            this.render();
        });

        // --- Wheel (uniform 2D zoom) ---
        c.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const zoomFactor = e.deltaY > 0 ? 1.12 : 1 / 1.12;

            const rect = c.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            
            // 1. Zoom X axis
            const pivotIndex = this._xToIndex(mx);
            let newCount = this.visibleCount * zoomFactor;
            newCount = Math.max(this.minVisibleCandles, Math.min(this.maxVisibleCandles, newCount));

            const fractionX = (mx - this.chartLeft) / this.chartWidth;
            let newStart = pivotIndex - fractionX * newCount;
            const maxStart = this.candles.length > 0 ? this.candles.length + 500 - newCount : 0;
            newStart = Math.max(0, Math.min(maxStart, newStart));

            this.visibleCount = newCount;
            this.visibleStart = newStart;

            // 2. Zoom Y axis uniformly to prevent stretching
            this.autoFitY = false;
            const pivotPrice = this._yToPrice(my);
            const range = this._visMax - this._visMin || 1;
            const newRange = range * zoomFactor;
            
            const fractionY = (this.chartBottom - my) / this.chartHeight;
            this._visMin = pivotPrice - fractionY * newRange;
            this._visMax = pivotPrice + (1 - fractionY) * newRange;

            this.render();
        }, { passive: false });

        c.style.cursor = 'crosshair';

        // --- Toolbar Buttons ---
        const replayBtn = document.getElementById('chart-replay-btn');
        if (replayBtn) replayBtn.onclick = () => this.replay();

        const axesBtn = document.getElementById('chart-axes-btn');
        if (axesBtn) axesBtn.onclick = () => {
            this.showAxes = !this.showAxes;
            this.render();
        };

        const gridBtn = document.getElementById('chart-grid-btn');
        if (gridBtn) gridBtn.onclick = () => {
            this.showGrid = !this.showGrid;
            this.render();
        };

        const fontBtn = document.getElementById('chart-font-btn');
        if (fontBtn) fontBtn.onclick = () => {
            // Cycle: 11 -> 13 -> 15 -> 9 -> 11
            if (this.chartFontSize === 11) this.chartFontSize = 13;
            else if (this.chartFontSize === 13) this.chartFontSize = 15;
            else if (this.chartFontSize === 15) this.chartFontSize = 9;
            else this.chartFontSize = 11;
            this.render();
        };

        // --- Drawing Tools ---
        const bindTool = (id, type) => {
            const btn = document.getElementById(id);
            if (btn) btn.onclick = () => {
                this.activeDrawTool = (this.activeDrawTool === type) ? null : type;
                this.drawingState = 0;
                this.currentDrawing = null;
                document.querySelectorAll('#tool-line, #tool-rect, #tool-text, #tool-percent').forEach(el => {
                    el.style.color = (el.id === id && this.activeDrawTool) ? '#38bdf8' : ''; // Active highlight
                });
            };
        };
        bindTool('tool-line', 'line');
        bindTool('tool-rect', 'rect');
        bindTool('tool-text', 'text');
        bindTool('tool-percent', 'percent');
        
        const scissorsBtn = document.getElementById('tool-scissors');
        if (scissorsBtn) scissorsBtn.onclick = () => {
            this.drawings = [];
            this.currentDrawing = null;
            this.drawingState = 0;
            this.activeDrawTool = null;
            document.querySelectorAll('#tool-line, #tool-rect, #tool-text, #tool-percent').forEach(el => el.style.color = '');
            this.render();
        };
    }

    replay() {
        // Simple replay: regenerate data and reset view
        this.generateMockData(2000);
    }

    // ------------------------------------------------------------------
    // Resize
    // ------------------------------------------------------------------
    resize() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width  = this.canvas.clientWidth  * dpr;
        this.canvas.height = this.canvas.clientHeight * dpr;
        this.render();
    }

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------
    render() {
        if (!this.ctx || !this.canvas || this.candles.length === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const W = this.canvas.clientWidth;
        const H = this.canvas.clientHeight;
        const ctx = this.ctx;

        ctx.resetTransform();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);

        // Fill canvas with --chart-bg (always darker than side panels)
        const chartBg = getComputedStyle(document.body).getPropertyValue('--chart-bg').trim() || '#e8e8ea';
        ctx.fillStyle = chartBg;
        ctx.fillRect(0, 0, W, H);

        // Recalculate visible price range
        this._computeVisibleRange();

        // Chart area clip
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.chartLeft, this.chartTop, this.chartWidth, this.chartHeight);
        ctx.clip();

        // --- Watermark ---
        this._drawWatermark(ctx);

        // --- Grid lines ---
        this._drawGrid(ctx, W, H);

        // --- Candles ---
        this._drawCandles(ctx);

        // --- Drawings ---
        this._drawDrawings(ctx);

        ctx.restore(); // unclip

        // --- Axes ---
        this._drawPriceAxis(ctx, H);
        this._drawTimeAxis(ctx, W);

        // --- Crosshair ---
        if (this.showCrosshair) {
            this._drawCrosshair(ctx, W, H);
        }
    }

    // ------------------------------------------------------------------
    // Drawings
    // ------------------------------------------------------------------
    _drawDrawings(ctx) {
        if (this.drawings.length === 0 && !this.currentDrawing) return;

        ctx.save();
        ctx.lineWidth = 2;

        let lastFont = '';
        let lastFill = '';
        let lastStroke = '';

        const drawItem = (d) => {
            if (!d.p1 || !d.p2) return;
            const x1 = this._indexToX(d.p1.x);
            const y1 = this._priceToY(d.p1.y);
            const x2 = this._indexToX(d.p2.x);
            const y2 = this._priceToY(d.p2.y);
            
            // Set basic styling if not already set
            if (lastStroke !== '#38bdf8') { ctx.strokeStyle = '#38bdf8'; lastStroke = '#38bdf8'; }
            if (lastFill !== 'rgba(56, 189, 248, 0.15)') { ctx.fillStyle = 'rgba(56, 189, 248, 0.15)'; lastFill = 'rgba(56, 189, 248, 0.15)'; }

            if (d.type === 'line') {
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            } else if (d.type === 'rect') {
                ctx.beginPath();
                ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
                ctx.fill();
                ctx.stroke();
            } else if (d.type === 'text') {
                if (lastFill !== '#e2e8f0') { ctx.fillStyle = '#e2e8f0'; lastFill = '#e2e8f0'; }
                if (lastFont !== '14px Inter, system-ui, sans-serif') { ctx.font = '14px Inter, system-ui, sans-serif'; lastFont = '14px Inter, system-ui, sans-serif'; }
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillText(d.text || 'Text', x1, y1);
            } else if (d.type === 'percent') {
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
                
                const px = (x1 + x2) / 2;
                const py = (y1 + y2) / 2;
                
                // Avoid recalculating string and measureText if static
                let text = d._text;
                let textW = d._textW;
                let pctVal = d._pct;
                
                if (d === this.currentDrawing || !text) {
                    const priceDiff = d.p2.y - d.p1.y;
                    pctVal = (priceDiff / d.p1.y * 100).toFixed(2);
                    text = `${pctVal > 0 ? '+' : ''}${pctVal}%`;
                    if (lastFont !== '12px Inter, system-ui, sans-serif') { ctx.font = '12px Inter, system-ui, sans-serif'; lastFont = '12px Inter, system-ui, sans-serif'; }
                    textW = ctx.measureText(text).width + 12;
                    // Cache it once finalized
                    if (d !== this.currentDrawing) {
                        d._text = text;
                        d._textW = textW;
                        d._pct = pctVal;
                    }
                } else {
                    if (lastFont !== '12px Inter, system-ui, sans-serif') { ctx.font = '12px Inter, system-ui, sans-serif'; lastFont = '12px Inter, system-ui, sans-serif'; }
                }

                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                if (lastFill !== 'rgba(15, 23, 42, 0.85)') { ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'; lastFill = 'rgba(15, 23, 42, 0.85)'; }
                ctx.fillRect(px - textW/2, py - 12, textW, 24);
                
                const color = pctVal > 0 ? '#4ade80' : (pctVal < 0 ? '#f87171' : '#e2e8f0');
                if (lastFill !== color) { ctx.fillStyle = color; lastFill = color; }
                ctx.fillText(text, px, py);
            }
            
            // Draw grab handles if hovered or dragging
            if (d === this.hoveredDrawing || d === this.draggingDrawing) {
                if (lastStroke !== '#38bdf8') { ctx.strokeStyle = '#38bdf8'; lastStroke = '#38bdf8'; }
                if (lastFill !== '#ffffff') { ctx.fillStyle = '#ffffff'; lastFill = '#ffffff'; }
                ctx.lineWidth = 2;
                
                ctx.beginPath(); ctx.arc(x1, y1, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.arc(x2, y2, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }
        };

        for (let i = 0; i < this.drawings.length; i++) drawItem(this.drawings[i]);
        if (this.currentDrawing) drawItem(this.currentDrawing);

        ctx.restore();
    }


    // ------------------------------------------------------------------
    // Watermark
    // ------------------------------------------------------------------
    _drawWatermark(ctx) {
        ctx.save();
        // Reduced size by 20% (from 84px to 67px)
        ctx.font = 'bold 67px Inter, system-ui, sans-serif';
        
        // Reduced opacity by 20% (from 1.0 to 0.8)
        ctx.fillStyle = 'rgba(128, 128, 128, 0.8)';
        
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        
        // Top right, slightly padded from the edges
        const x = this.chartRight - 20;
        const y = this.chartTop + 20;
        
        ctx.fillText(this.ticker, x, y);
        ctx.restore();
    }

    // ------------------------------------------------------------------
    // Grid
    // ------------------------------------------------------------------
    _drawGrid(ctx) {
        if (!this.showGrid) return;
        const range = this._visMax - this._visMin;
        const rawStep = range / 8;
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const residual = rawStep / mag;
        let step;
        if (residual <= 1.5) step = mag;
        else if (residual <= 3.5) step = 2 * mag;
        else if (residual <= 7.5) step = 5 * mag;
        else step = 10 * mag;

        ctx.strokeStyle = 'rgba(128, 128, 128, 0.08)';
        ctx.lineWidth = 1;

        // Horizontal grid (price levels)
        const firstPrice = Math.ceil(this._visMin / step) * step;
        for (let p = firstPrice; p <= this._visMax; p += step) {
            const y = this._priceToY(p);
            ctx.beginPath();
            ctx.moveTo(this.chartLeft, y);
            ctx.lineTo(this.chartRight, y);
            ctx.stroke();
        }

        // Vertical grid (every N candles)
        const candleW = this.chartWidth / this.visibleCount;
        let labelEvery;
        if (candleW > 40) labelEvery = 5;
        else if (candleW > 15) labelEvery = 10;
        else if (candleW > 6) labelEvery = 30;
        else if (candleW > 2) labelEvery = 60;
        else labelEvery = 120;

        const firstIdx = Math.ceil(this.visibleStart / labelEvery) * labelEvery;
        for (let i = firstIdx; i < this.visibleStart + this.visibleCount; i += labelEvery) {
            const x = this._indexToX(i);
            if (x < this.chartLeft || x > this.chartRight) continue;
            ctx.beginPath();
            ctx.moveTo(x, this.chartTop);
            ctx.lineTo(x, this.chartBottom);
            ctx.stroke();
        }
    }

    // ------------------------------------------------------------------
    // Candles
    // ------------------------------------------------------------------
    _drawCandles(ctx) {
        const candleW = this.chartWidth / this.visibleCount;
        const bodyW = Math.max(1, candleW * 0.7);
        const wickW = Math.max(1, Math.min(candleW * 0.12, 2));

        const startIdx = Math.max(0, Math.floor(this.visibleStart));
        const endIdx   = Math.min(this.candles.length, Math.ceil(this.visibleStart + this.visibleCount));

        for (let i = startIdx; i < endIdx; i++) {
            const c = this.candles[i];
            const cx = this._indexToX(i);

            const openY  = this._priceToY(c.open);
            const closeY = this._priceToY(c.close);
            const highY  = this._priceToY(c.high);
            const lowY   = this._priceToY(c.low);

            const isBull = c.close >= c.open;
            const color  = isBull ? '#26a69a' : '#ef5350';

            // Wick
            ctx.strokeStyle = color;
            ctx.lineWidth = wickW;
            ctx.beginPath();
            ctx.moveTo(cx, highY);
            ctx.lineTo(cx, lowY);
            ctx.stroke();

            // Body
            const bodyTop = Math.min(openY, closeY);
            const bodyH   = Math.max(Math.abs(openY - closeY), 1);

            if (isBull && candleW > 3) {
                // Hollow bull candle when zoomed in enough
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.strokeRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
            } else {
                ctx.fillStyle = color;
                ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
            }
        }
    }

    // ------------------------------------------------------------------
    // Price Axis (right side and left side)
    // ------------------------------------------------------------------
    _drawPriceAxis(ctx, H) {
        if (!this.showAxes) return;
        // Axis backgrounds
        ctx.fillStyle = 'rgba(30, 30, 40, 0.04)';
        ctx.fillRect(this.chartRight, 0, 48, H);       // right axis bg
        ctx.fillRect(this.chartLeft - 48, 0, 48, H);   // left axis bg

        // --- Scattered Vertical Rectangles in Left Axis ---
        if (!this.leftScatteredRects && this.candles.length > 0) {
            let globalMin = Infinity, globalMax = -Infinity;
            for (let c of this.candles) {
                if (c.high > globalMax) globalMax = c.high;
                if (c.low < globalMin) globalMin = c.low;
            }
            
            let extendedMax = globalMax + (globalMax - globalMin) * 2.5; 
            let extendedMin = globalMin - (globalMax - globalMin) * 0.5;

            this.leftScatteredRects = [];
            const colors = ['#4a148c', '#424242', '#8b0000', '#006400']; // dark purple, dark grey, dark red, dark green
            for (let c of colors) {
                let currentP = extendedMin;
                while (currentP < extendedMax) {
                    currentP += Math.random() * ((globalMax - globalMin) * 0.1) + ((globalMax - globalMin) * 0.05);
                    if (currentP >= extendedMax) break;
                    
                    let heightP = Math.random() * ((globalMax - globalMin) * 0.08) + ((globalMax - globalMin) * 0.02);
                    let endP = currentP + heightP;
                    if (endP > extendedMax) endP = extendedMax;
                    
                    this.leftScatteredRects.push({
                        x: Math.random() * 26 + 6,
                        priceMin: currentP,
                        priceMax: endP,
                        color: c
                    });
                    currentP = endP;
                }
            }
        }
        if (this.leftScatteredRects) {
            const rectW = 8;
            for (const rect of this.leftScatteredRects) {
                const y1 = this._priceToY(rect.priceMax);
                const y2 = this._priceToY(rect.priceMin);
                
                let drawY1 = Math.max(this.chartTop, y1);
                let drawY2 = Math.min(this.chartBottom, y2);
                let drawH = drawY2 - drawY1;
                
                if (drawH > 0) {
                    ctx.fillStyle = rect.color;
                    ctx.fillRect(this.chartLeft - 48 + rect.x, drawY1, rectW, drawH);
                }
            }
        }

        // Separator lines
        ctx.strokeStyle = 'rgba(128, 128, 128, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // right separator
        ctx.moveTo(this.chartRight, this.chartTop);
        ctx.lineTo(this.chartRight, this.chartBottom);
        // left separator
        ctx.moveTo(this.chartLeft, this.chartTop);
        ctx.lineTo(this.chartLeft, this.chartBottom);
        ctx.stroke();

        // Price labels
        const range = this._visMax - this._visMin;
        const rawStep = range / 8;
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const residual = rawStep / mag;
        let step;
        if (residual <= 1.5) step = mag;
        else if (residual <= 3.5) step = 2 * mag;
        else if (residual <= 7.5) step = 5 * mag;
        else step = 10 * mag;

        const decimals = step < 1 ? 2 : (step < 10 ? 1 : 0);

        ctx.fillStyle = 'rgba(120, 120, 140, 0.85)';
        ctx.font = `${this.chartFontSize}px Inter, system-ui, sans-serif`;
        ctx.textBaseline = 'middle';

        const firstPrice = Math.ceil(this._visMin / step) * step;
        for (let p = firstPrice; p <= this._visMax; p += step) {
            const y = this._priceToY(p);
            if (y < this.chartTop + 8 || y > this.chartBottom - 8) continue;
            
            const pStr = p.toFixed(decimals);
            
            // Right label
            ctx.textAlign = 'left';
            ctx.fillText(pStr, this.chartRight + 6, y);
            
            // Left label
            ctx.textAlign = 'right';
            ctx.fillText(pStr, this.chartLeft - 6, y);
        }

        // --- Random Highlighted Price Levels ---
        if (!this.randomPriceLevels && this.candles.length > 0) {
            let globalMin = Infinity, globalMax = -Infinity;
            for (let c of this.candles) {
                if (c.high > globalMax) globalMax = c.high;
                if (c.low < globalMin) globalMin = c.low;
            }

            let extendedMax = globalMax + (globalMax - globalMin) * 2.5; 
            let extendedMin = globalMin - (globalMax - globalMin) * 0.5;

            this.randomPriceLevels = [];
            const colors = ['#5c6bc0', '#26a69a', '#ef5350', '#f59e0b', '#8b5cf6'];
            for (let i = 0; i < 12; i++) {
                this.randomPriceLevels.push({
                    price: extendedMin + Math.random() * (extendedMax - extendedMin),
                    color: colors[Math.floor(Math.random() * colors.length)]
                });
            }
        }
        if (this.randomPriceLevels) {
            const labelW = 48;
            const labelH = 18;
            ctx.font = 'bold 11px Inter, system-ui, sans-serif';
            ctx.textBaseline = 'middle';

            for (const level of this.randomPriceLevels) {
                const y = this._priceToY(level.price);
                if (y < this.chartTop + 8 || y > this.chartBottom - 8) continue;
                
                const priceStr = level.price.toFixed(2);
                
                // Right label
                ctx.fillStyle = level.color;
                ctx.fillRect(this.chartRight, y - labelH / 2, labelW, labelH);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.fillText(priceStr, this.chartRight + labelW / 2, y);

                // Left label
                ctx.fillStyle = level.color;
                ctx.fillRect(this.chartLeft - labelW, y - labelH / 2, labelW, labelH);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.fillText(priceStr, this.chartLeft - labelW / 2, y);
            }
        }
    }

    // ------------------------------------------------------------------
    // Time Axis (bottom)
    // ------------------------------------------------------------------
    _drawTimeAxis(ctx, W) {
        if (!this.showAxes) return;
        // Axis background
        ctx.fillStyle = 'rgba(30, 30, 40, 0.04)';
        ctx.fillRect(this.chartLeft, this.chartBottom, this.chartWidth, this.canvas.clientHeight - this.chartBottom);

        // Separator
        ctx.strokeStyle = 'rgba(128, 128, 128, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.chartLeft, this.chartBottom);
        ctx.lineTo(this.chartRight, this.chartBottom);
        ctx.stroke();

        const candleW = this.chartWidth / this.visibleCount;
        let labelEvery;
        if (candleW > 40) labelEvery = 5;
        else if (candleW > 15) labelEvery = 10;
        else if (candleW > 6) labelEvery = 30;
        else if (candleW > 2) labelEvery = 60;
        else labelEvery = 120;

        ctx.fillStyle = 'rgba(120, 120, 140, 0.7)';
        ctx.font = `${Math.max(9, this.chartFontSize - 1)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const firstIdx = Math.ceil(this.visibleStart / labelEvery) * labelEvery;
        for (let i = firstIdx; i < this.visibleStart + this.visibleCount; i += labelEvery) {
            if (i < 0 || i >= this.candles.length) continue;
            const x = this._indexToX(i);
            if (x < this.chartLeft + 20 || x > this.chartRight - 20) continue;

            const d = new Date(this.candles[i].time);
            const hh = d.getHours().toString().padStart(2, '0');
            const mm = d.getMinutes().toString().padStart(2, '0');
            ctx.fillText(`${hh}:${mm}`, x, this.chartBottom + 6);
        }
    }

    // ------------------------------------------------------------------
    // Crosshair
    // ------------------------------------------------------------------
    _drawCrosshair(ctx, W, H) {
        const mx = this.mouseX;
        const my = this.mouseY;

        // Snap to nearest candle
        const rawIdx = this._xToIndex(mx);
        const snapIdx = Math.round(rawIdx);
        if (snapIdx < 0 || snapIdx >= this.candles.length) return;

        const snapX = this._indexToX(snapIdx);
        const price = this._yToPrice(my);

        // Dashed lines
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(140, 140, 160, 0.5)';
        ctx.lineWidth = 1;

        // Vertical
        ctx.beginPath();
        ctx.moveTo(snapX, this.chartTop);
        ctx.lineTo(snapX, this.chartBottom);
        ctx.stroke();

        // Horizontal
        ctx.beginPath();
        ctx.moveTo(this.chartLeft, my);
        ctx.lineTo(this.chartRight, my);
        ctx.stroke();
        ctx.restore();

        // Price label on axis
        const priceStr = price.toFixed(2);
        const labelW = 48;
        const labelH = 18;

        ctx.font = 'bold 11px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        // Right crosshair label
        ctx.fillStyle = '#5c6bc0';
        ctx.fillRect(this.chartRight, my - labelH / 2, labelW, labelH);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(priceStr, this.chartRight + labelW / 2, my);

        // Left crosshair label
        ctx.fillStyle = '#5c6bc0';
        ctx.fillRect(this.chartLeft - labelW, my - labelH / 2, labelW, labelH);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(priceStr, this.chartLeft - labelW / 2, my);

        // Time label on bottom axis
        const cSnap = this.candles[snapIdx];
        if (cSnap) {
            const d = new Date(cSnap.time);
            const hh = d.getHours().toString().padStart(2, '0');
            const mm = d.getMinutes().toString().padStart(2, '0');
            const timeStr = `${hh}:${mm}`;
            const timeLabelW = 50;
            ctx.fillStyle = '#5c6bc0';
            ctx.fillRect(snapX - timeLabelW / 2, this.chartBottom, timeLabelW, labelH);
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.fillText(timeStr, snapX, this.chartBottom + labelH / 2);
        }

        // OHLCV tooltip (bottom-right corner, above X-axis)
        const c = this.candles[snapIdx];
        if (!c) return;
        const isBull = c.close >= c.open;
        const tooltipColor = isBull ? '#26a69a' : '#ef5350';

        ctx.font = '12px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';

        const labels = [
            { key: 'O', val: c.open.toFixed(2) },
            { key: 'H', val: c.high.toFixed(2) },
            { key: 'L', val: c.low.toFixed(2) },
            { key: 'C', val: c.close.toFixed(2) },
            { key: 'V', val: c.volume ? c.volume.toLocaleString() : '0' },
        ];

        let totalWidth = 0;
        for (const l of labels) {
            totalWidth += ctx.measureText(l.key + ' ').width;
            totalWidth += ctx.measureText(l.val + '   ').width;
        }

        let tx = this.chartRight - totalWidth - 8;
        const ty = this.chartBottom - 8;

        for (const l of labels) {
            ctx.fillStyle = 'rgba(140, 140, 160, 0.7)';
            ctx.fillText(l.key + ' ', tx, ty);
            tx += ctx.measureText(l.key + ' ').width;
            ctx.fillStyle = tooltipColor;
            ctx.fillText(l.val + '   ', tx, ty);
            tx += ctx.measureText(l.val + '   ').width;
        }
    }
}

window.q4NativeChart = null;
