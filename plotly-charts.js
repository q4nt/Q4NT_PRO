// ===== Plotly Sub-Tab Charts =====
// Layout builders and config are hoisted to module scope so they are
// created once, not re-allocated on every renderPlotlySubTabCharts() call.

var _plotlyCfg = { displayModeBar: false, responsive: true };
var _plotlyFont = 'DM Sans, sans-serif';
var _plotlyNavy5 = ['#1B2A4A', '#2C4066', '#415A77', '#5E7A95', '#778DA9', '#A8BCCF'];
var _plotlyWarm5 = ['#C4553A', '#D47A3E', '#E0A04D', '#D4C06A', '#A8B87C', '#8AABA0'];
var _plotlyTeal5 = ['#1A4A3A', '#2E7D6F', '#4AA391', '#78C1B3', '#A8DDD2', '#D2F0EA'];

// Base layout for standard charts -- merge extra props via Object.assign
function _plotlyL(extra) {
    var base = {
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { t: 4, b: 24, l: 32, r: 8 }, font: { family: _plotlyFont, size: 9, color: '#415A77' },
        showlegend: false,
        xaxis: { showgrid: false, gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false },
        yaxis: { showgrid: false, gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false },
        hoverlabel: { bgcolor: '#1B2A4A', font: { family: _plotlyFont, size: 9, color: '#fff' } }
    };
    if (extra) {
        // Deep-merge axis objects so showgrid:false is always preserved
        ['xaxis', 'yaxis', 'yaxis2'].forEach(function (k) {
            if (extra[k]) { extra[k] = Object.assign({ showgrid: false }, extra[k]); }
        });
        Object.assign(base, extra);
    }
    return base;
}

// Base layout for pie/donut/sunburst/treemap charts
function _plotlyPieL(extra) {
    return Object.assign({
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { t: 4, b: 4, l: 4, r: 4 }, font: { family: _plotlyFont, size: 9 },
        showlegend: false,
        hoverlabel: { bgcolor: '#1B2A4A', font: { family: _plotlyFont, size: 9, color: '#fff' } }
    }, extra || {});
}

function renderPlotlySubTabCharts() {
    var cfg = _plotlyCfg;
    var ff = _plotlyFont;
    var navy5 = _plotlyNavy5;
    var warm5 = _plotlyWarm5;
    var teal5 = _plotlyTeal5;
    function L(extra) { return _plotlyL(extra); }
    function pieL(extra) { return _plotlyPieL(extra); }

    var Q = ['Q1 22', 'Q2 22', 'Q3 22', 'Q4 22', 'Q1 23', 'Q2 23', 'Q3 23', 'Q4 23', 'Q1 24', 'Q2 24', 'Q3 24', 'Q4 24', 'Q1 25', 'Q2 25', 'Q3 25', 'Q4 25'];

    // 1 - Stacked Area: ARR
    Plotly.newPlot('pc1', [
        { x: Q, y: [320, 340, 365, 390, 420, 455, 490, 530, 575, 620, 670, 720, 780, 840, 910, 980], name: 'Platform', fill: 'tozeroy', line: { color: '#1B2A4A', width: 0 }, fillcolor: 'rgba(27,42,74,0.85)', mode: 'none' },
        { x: Q, y: [180, 195, 210, 230, 255, 280, 310, 345, 380, 420, 465, 510, 560, 620, 680, 750], name: 'Data & Analytics', fill: 'tonexty', line: { color: '#2E7D6F', width: 0 }, fillcolor: 'rgba(46,125,111,0.75)', mode: 'none' },
        { x: Q, y: [120, 125, 135, 145, 160, 175, 192, 210, 230, 252, 278, 305, 335, 368, 405, 445], name: 'Security', fill: 'tonexty', line: { color: '#C49B3C', width: 0 }, fillcolor: 'rgba(196,155,60,0.7)', mode: 'none' },
        { x: Q, y: [80, 82, 88, 95, 105, 115, 128, 140, 155, 172, 190, 210, 232, 258, 285, 315], name: 'Services', fill: 'tonexty', line: { color: '#C4553A', width: 0 }, fillcolor: 'rgba(196,85,58,0.65)', mode: 'none' }
    ], L({ yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false, tickprefix: '$' } }), cfg);

    // 2 - Donut
    Plotly.newPlot('pc2', [{
        type: 'pie', labels: ['Salesforce', 'Microsoft', 'Oracle', 'SAP', 'HubSpot', 'Others'], values: [23.8, 5.8, 4.8, 3.6, 3.2, 58.8],
        hole: 0.5, marker: { colors: navy5, line: { color: '#fff', width: 1.5 } }, textinfo: 'percent', textposition: 'inside', textfont: { size: 8, color: '#fff' }, sort: false, direction: 'clockwise', rotation: -20, hoverinfo: 'label+value+percent'
    }], pieL({ annotations: [{ text: '<b>$98B</b>', showarrow: false, font: { family: ff, size: 12, color: '#1B2A4A' }, x: 0.5, y: 0.5 }] }), cfg);

    // 3 - Grouped bar
    Plotly.newPlot('pc3', [
        { x: ['NAM', 'EMEA', 'APAC', 'LATAM'], y: [1680, 920, 580, 240], name: 'FY2024', type: 'bar', marker: { color: '#A8BCCF' } },
        { x: ['NAM', 'EMEA', 'APAC', 'LATAM'], y: [1890, 1050, 756, 294], name: 'FY2025', type: 'bar', marker: { color: '#1B2A4A' } }
    ], L({ barmode: 'group', bargap: 0.25, bargroupgap: 0.08, yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false, tickprefix: '$' } }), cfg);

    // 4 - Line: Margins
    var q8 = ['Q1 24', 'Q2 24', 'Q3 24', 'Q4 24', 'Q1 25', 'Q2 25', 'Q3 25', 'Q4 25'];
    Plotly.newPlot('pc4', [
        { x: q8, y: [72, 73, 71.5, 74, 73.5, 75, 76, 77], name: 'Gross', mode: 'lines+markers', line: { color: '#1B2A4A', width: 2 }, marker: { size: 3 } },
        { x: q8, y: [28, 29, 27, 30, 29.5, 31, 32, 33], name: 'EBITDA', mode: 'lines+markers', line: { color: '#2E7D6F', width: 2 }, marker: { size: 3 } },
        { x: q8, y: [18, 19, 17.5, 20, 19, 21, 22, 23], name: 'Net', mode: 'lines+markers', line: { color: '#C49B3C', width: 2 }, marker: { size: 3 } }
    ], L({ yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false, ticksuffix: '%', range: [10, 85] } }), cfg);

    // 5 - Waterfall
    Plotly.newPlot('pc5', [{
        type: 'waterfall', orientation: 'v',
        x: ['FY24', 'Vol', 'Price', 'New', 'COGS', 'OpEx', 'FX', 'FY25'],
        y: [420, 85, 42, 38, -52, -28, -15, null],
        measure: ['absolute', 'relative', 'relative', 'relative', 'relative', 'relative', 'relative', 'total'],
        connector: { line: { color: '#DFE3EA', width: 1 } },
        increasing: { marker: { color: '#2E7D6F' } }, decreasing: { marker: { color: '#C4553A' } }, totals: { marker: { color: '#1B2A4A' } },
        textposition: 'outside', text: ['420', '+85', '+42', '+38', '-52', '-28', '-15', '490'], textfont: { family: ff, size: 7, color: '#415A77' }
    }], L({ showlegend: false, yaxis: { visible: false }, xaxis: { tickfont: { size: 7 } } }), cfg);

    // 6 - Horizontal bar
    var ceoL = ['AI', 'Cyber', 'Talent', 'Sust.', 'Cost', 'Supply', 'Expand', 'M&A'];
    var ceoV = [78, 65, 58, 52, 48, 41, 35, 29];
    var ceoColors = ['#1B2A4A', '#2C4066', '#415A77', '#5E7A95', '#778DA9', '#8FA5BB', '#A8BCCF', '#C0D0DE'];
    Plotly.newPlot('pc6', [{
        type: 'bar', y: ceoL, x: ceoV, orientation: 'h',
        marker: { color: ceoV.map(function (_, i) { return ceoColors[i]; }) },
        text: ceoV.map(function (v) { return v + '%'; }), textposition: 'outside', textfont: { family: ff, size: 8, color: '#1B2A4A' }
    }], L({ showlegend: false, margin: { t: 4, b: 10, l: 48, r: 30 }, xaxis: { visible: false }, yaxis: { gridcolor: 'rgba(0,0,0,0)', linecolor: 'rgba(0,0,0,0)', tickfont: { size: 8, color: '#1B2A4A' }, autorange: 'reversed' } }), cfg);

    // 7 - Pie
    Plotly.newPlot('pc7', [{
        type: 'pie', labels: ['Comp', 'Career', 'Mgmt', 'W-L', 'Reloc', 'Other'], values: [31, 24, 18, 14, 7, 6],
        hole: 0, marker: { colors: warm5, line: { color: '#fff', width: 1.5 } }, textinfo: 'percent', textposition: 'inside', textfont: { size: 8, color: '#fff' },
        pull: [0.06, 0, 0, 0, 0, 0], sort: false, direction: 'clockwise', rotation: 30, hoverinfo: 'label+value+percent'
    }], pieL({ showlegend: false }), cfg);

    // 8 - Scatter
    var tn = []; var qt = [];
    for (var i = 0; i < 60; i++) { var t = Math.random() * 48 + 2; tn.push(t); qt.push(Math.min(40 + t * 1.8 + Math.random() * 40 - 20, 160)); }
    Plotly.newPlot('pc8', [
        { x: tn, y: qt, mode: 'markers', type: 'scatter', marker: { color: '#1B2A4A', size: 3, opacity: 0.5 }, showlegend: false },
        { x: [2, 50], y: [43, 130], mode: 'lines', line: { color: '#C4553A', width: 1.5, dash: 'dot' }, showlegend: false }
    ], L({ showlegend: false, margin: { t: 4, b: 24, l: 30, r: 8 }, xaxis: { title: { text: 'Months', font: { size: 7, color: '#778DA9' } }, gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 7 }, zeroline: false }, yaxis: { title: { text: 'Quota %', font: { size: 7, color: '#778DA9' } }, gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 7 }, zeroline: false, ticksuffix: '%' } }), cfg);

    // 9 - Funnel
    Plotly.newPlot('pc9', [{
        type: 'funnel', y: ['Leads', 'MQLs', 'SQLs', 'Proposals', 'Nego', 'Won'],
        x: [2840, 1420, 680, 340, 195, 112],
        marker: { color: ['#1B2A4A', '#2C4066', '#415A77', '#5E7A95', '#778DA9', '#2E7D6F'], line: { color: '#fff', width: 1 } },
        textinfo: 'value+percent initial', textfont: { family: ff, size: 8, color: '#fff' },
        connector: { line: { color: '#DFE3EA', width: 1 } }
    }], L({ showlegend: false, margin: { t: 4, b: 4, l: 60, r: 4 }, xaxis: { visible: false }, yaxis: { tickfont: { size: 8, color: '#1B2A4A' }, linecolor: 'rgba(0,0,0,0)' }, funnelmode: 'stack' }), cfg);

    // 10 - Sunburst
    Plotly.newPlot('pc10', [{
        type: 'sunburst',
        labels: ['Total', 'Petrol', 'NatGas', 'Coal', 'Nuclear', 'Renew', 'Trans', 'Ind-P', 'Res-P', 'Elec-G', 'Ind-G', 'Res-G', 'Elec-C', 'Ind-C', 'Elec-N', 'Hydro', 'Wind', 'Solar', 'Bio'],
        parents: ['', 'Total', 'Total', 'Total', 'Total', 'Total', 'Petrol', 'Petrol', 'Petrol', 'NatGas', 'NatGas', 'NatGas', 'Coal', 'Coal', 'Nuclear', 'Renew', 'Renew', 'Renew', 'Renew'],
        values: [101.3, 36.1, 33.4, 10.2, 8.1, 13.5, 26.2, 6.8, 3.1, 12.8, 10.4, 5.6, 8.9, 1.3, 8.1, 2.7, 4.2, 3.8, 2.1],
        branchvalues: 'total',
        marker: { colors: ['#E8EDF2', '#1B2A4A', '#415A77', '#6B4226', '#C49B3C', '#2E7D6F', '#2C4066', '#3B5580', '#4F6A94', '#516D8A', '#627E9B', '#7690AB', '#7D5A38', '#946F4C', '#DAB45E', '#1A6B5A', '#2E8D7A', '#45A893', '#5FC1AC'], line: { color: '#fff', width: 1 } },
        textfont: { family: ff, size: 8, color: '#fff' }, insidetextorientation: 'radial', hoverinfo: 'label+value+percent parent'
    }], pieL({ showlegend: false }), cfg);

    // 11 - Multi-line: TSR
    var months = [];
    for (var m = 0; m < 46; m++) { var d = new Date(2022, 0, 1); d.setMonth(d.getMonth() + m); months.push(d.toISOString().slice(0, 7)); }
    function tsr(seed, drift) { var v = 100; var r = []; for (var j = 0; j < 46; j++) { v += drift + (Math.sin(seed * j) * 4 + Math.random() * 6 - 3); r.push(Math.round(v * 10) / 10); } return r; }
    Plotly.newPlot('pc11', [
        { x: months, y: tsr(0.3, 1.4), name: 'Company', mode: 'lines', line: { color: '#1B2A4A', width: 2 } },
        { x: months, y: tsr(0.5, 1.1), name: 'Peer Med', mode: 'lines', line: { color: '#778DA9', width: 1.5, dash: 'dot' } },
        { x: months, y: tsr(0.7, 0.8), name: 'S&P 500', mode: 'lines', line: { color: '#C49B3C', width: 1.5, dash: 'dash' } },
        { x: months, y: tsr(0.2, 0.5), name: 'Peer Low', mode: 'lines', line: { color: '#C4553A', width: 1, dash: 'dashdot' } }
    ], L({}), cfg);

    // 12 - Stacked bar
    Plotly.newPlot('pc12', [
        { x: ['FY22', 'FY23', 'FY24', 'FY25'], y: [420, 480, 540, 610], name: 'Eng', type: 'bar', marker: { color: '#1B2A4A' } },
        { x: ['FY22', 'FY23', 'FY24', 'FY25'], y: [180, 210, 250, 280], name: 'Sales', type: 'bar', marker: { color: '#415A77' } },
        { x: ['FY22', 'FY23', 'FY24', 'FY25'], y: [120, 135, 155, 175], name: 'G&A', type: 'bar', marker: { color: '#778DA9' } },
        { x: ['FY22', 'FY23', 'FY24', 'FY25'], y: [80, 95, 115, 140], name: 'Other', type: 'bar', marker: { color: '#A8BCCF' } }
    ], L({ barmode: 'stack' }), cfg);

    // 13 - Heatmap
    var kpis = ['Rev', 'NPS', 'Churn', 'ARPU', 'CAC', 'LTV'];
    var corr = [[1, .72, -.68, .85, -.31, .91], [.72, 1, -.82, .55, -.18, .64], [-.68, -.82, 1, -.61, .45, -.73], [.85, .55, -.61, 1, -.22, .88], [-.31, -.18, .45, -.22, 1, -.41], [.91, .64, -.73, .88, -.41, 1]];
    Plotly.newPlot('pc13', [{
        type: 'heatmap', z: corr, x: kpis, y: kpis,
        colorscale: [[0, '#C4553A'], [0.5, '#F6F7F9'], [1, '#1B2A4A']], zmin: -1, zmax: 1,
        text: corr.map(function (r) { return r.map(function (v) { return v.toFixed(2); }); }), texttemplate: '%{text}', textfont: { family: ff, size: 7 },
        hoverinfo: 'x+y+z', showscale: false
    }], L({ showlegend: false, margin: { t: 4, b: 35, l: 38, r: 4 }, xaxis: { tickangle: -45, tickfont: { size: 7 } }, yaxis: { tickfont: { size: 7 }, autorange: 'reversed' } }), cfg);

    // 14 - Radar
    Plotly.newPlot('pc14', [
        { type: 'scatterpolar', r: [8, 7, 9, 6, 8, 7, 8], theta: ['Product', 'Price', 'Dist', 'Brand', 'Innov', 'Talent', 'Product'], fill: 'toself', name: 'Us', fillcolor: 'rgba(27,42,74,0.15)', line: { color: '#1B2A4A', width: 1.5 }, marker: { size: 3 } },
        { type: 'scatterpolar', r: [7, 8, 6, 8, 6, 5, 7], theta: ['Product', 'Price', 'Dist', 'Brand', 'Innov', 'Talent', 'Product'], fill: 'toself', name: 'Comp A', fillcolor: 'rgba(196,85,58,0.1)', line: { color: '#C4553A', width: 1.5, dash: 'dot' }, marker: { size: 3 } }
    ], {
        paper_bgcolor: 'rgba(0,0,0,0)', font: { family: ff, size: 8, color: '#415A77' },
        margin: { t: 20, b: 10, l: 30, r: 30 }, showlegend: false,
        polar: { bgcolor: 'rgba(0,0,0,0)', radialaxis: { visible: true, range: [0, 10], tickfont: { size: 7 }, showgrid: false, gridcolor: '#E8EDF2', linecolor: '#DFE3EA' }, angularaxis: { tickfont: { size: 7, color: '#1B2A4A' }, showgrid: false, gridcolor: '#E8EDF2', linecolor: '#DFE3EA' } },
        hoverlabel: { bgcolor: '#1B2A4A', font: { family: ff, size: 9, color: '#fff' } }
    }, cfg);

    // 15 - Wide grouped bar: TAM
    var segs = ['Identity', 'Cloud WL', 'Email', 'SIEM', 'Network', 'Endpoint', 'Data', 'API'];
    Plotly.newPlot('pc15', [
        { x: segs, y: [42, 38, 22, 28, 35, 31, 18, 12], name: 'TAM', type: 'bar', marker: { color: '#A8BCCF' } },
        { x: segs, y: [18, 15, 9, 11, 12, 13, 7, 5], name: 'SAM', type: 'bar', marker: { color: '#415A77' } },
        { x: segs, y: [4.2, 3.1, 2.8, 2.1, 1.8, 1.5, 1.2, 0.8], name: 'SOM', type: 'bar', marker: { color: '#1B2A4A' } }
    ], L({ barmode: 'group', bargap: 0.2, bargroupgap: 0.06, margin: { t: 4, b: 30, l: 32, r: 8 }, yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 7 }, zeroline: false, tickprefix: '$', ticksuffix: 'B' }, xaxis: { tickangle: -25, tickfont: { size: 7 } } }), cfg);

    // 16 - Thin ring
    Plotly.newPlot('pc16', [{
        type: 'pie', labels: ['Eng', 'Sales', 'G&A', 'R&D', 'Support', 'Legal'], values: [28, 22, 15, 18, 10, 7],
        hole: 0.7, marker: { colors: teal5, line: { color: '#fff', width: 1.5 } }, textinfo: 'percent', textposition: 'inside', textfont: { size: 8, color: '#fff' }, sort: false, direction: 'clockwise', hoverinfo: 'label+value+percent'
    }], pieL({ annotations: [{ text: '<b>$82M</b>', showarrow: false, font: { family: ff, size: 11, color: '#1B2A4A' }, x: 0.5, y: 0.5 }] }), cfg);

    // 17 - Bar + Line Combo
    var mo = ['Jan', 'Mar', 'May', 'Jul', 'Sep', 'Nov', 'Jan', 'Mar', 'May', 'Jul', 'Sep'];
    Plotly.newPlot('pc17', [
        { x: mo, y: [2800, 2650, 2500, 2400, 2300, 2200, 2150, 2050, 1980, 1900, 1850], name: 'CAC', type: 'bar', marker: { color: '#C4553A' }, yaxis: 'y' },
        { x: mo, y: [6800, 7100, 7400, 7600, 7900, 8100, 8400, 8600, 8800, 9000, 9200], name: 'LTV', type: 'bar', marker: { color: '#1B2A4A' }, yaxis: 'y' },
        { x: mo, y: [2.4, 2.7, 3.0, 3.2, 3.4, 3.7, 3.9, 4.2, 4.4, 4.7, 5.0], name: 'Ratio', mode: 'lines+markers', line: { color: '#C49B3C', width: 2 }, marker: { size: 4, color: '#C49B3C' }, yaxis: 'y2' }
    ], L({
        barmode: 'group', bargap: 0.3,
        margin: { t: 4, b: 24, l: 36, r: 36 },
        yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 7 }, zeroline: false, tickprefix: '$' },
        yaxis2: { overlaying: 'y', side: 'right', gridcolor: 'rgba(0,0,0,0)', linecolor: '#DFE3EA', tickfont: { size: 7, color: '#C49B3C' }, zeroline: false, ticksuffix: 'x', range: [0, 6] }
    }), cfg);

    // 18 - Treemap
    Plotly.newPlot('pc18', [{
        type: 'treemap',
        labels: ['Revenue', 'Platform', 'Services', 'Hardware', 'Licensing', 'Cloud', 'On-Prem', 'Consulting', 'Support', 'Devices', 'Accsry', 'Enterprise', 'SMB'],
        parents: ['', 'Revenue', 'Revenue', 'Revenue', 'Revenue', 'Platform', 'Platform', 'Services', 'Services', 'Hardware', 'Hardware', 'Licensing', 'Licensing'],
        values: [0, 0, 0, 0, 0, 320, 140, 180, 95, 110, 45, 72, 38],
        branchvalues: 'remainder',
        marker: { colors: ['#E8EDF2', '#1B2A4A', '#C4553A', '#2E7D6F', '#C49B3C', '#2C4066', '#415A77', '#A8453A', '#D4826A', '#236B5C', '#4AA391', '#A8842E', '#DAB45E'], line: { color: '#fff', width: 1.5 } },
        textfont: { family: ff, size: 9, color: '#fff' }, textinfo: 'label+value', texttemplate: '<b>%{label}</b><br>$%{value}M', hoverinfo: 'label+value+percent parent'
    }], pieL({ showlegend: false }), cfg);

    // 19 - Diverging bar: NPS
    var npsS = ['Enterprise', 'Mid-Mkt', 'SMB', 'Startup', 'Gov', 'Student'];
    var npsPromo = [58, 45, 42, 62, 38, 52];
    var npsDet = [12, 22, 28, 15, 30, 18];
    Plotly.newPlot('pc19', [
        { y: npsS, x: npsPromo, type: 'bar', orientation: 'h', name: 'Promoters', marker: { color: '#2E7D6F' }, text: npsPromo.map(function (v) { return v + '%'; }), textposition: 'outside', textfont: { size: 7 } },
        { y: npsS, x: npsDet.map(function (v) { return -v; }), type: 'bar', orientation: 'h', name: 'Detractors', marker: { color: '#C4553A' }, text: npsDet.map(function (v) { return v + '%'; }), textposition: 'outside', textfont: { size: 7 } }
    ], L({ barmode: 'relative', showlegend: false, margin: { t: 4, b: 10, l: 60, r: 24 }, xaxis: { zeroline: true, zerolinecolor: '#1B2A4A', zerolinewidth: 1, visible: false }, yaxis: { tickfont: { size: 7, color: '#1B2A4A' }, linecolor: 'rgba(0,0,0,0)', gridcolor: 'rgba(0,0,0,0)', autorange: 'reversed' } }), cfg);

    // 20 - Large donut: VC
    Plotly.newPlot('pc20', [{
        type: 'pie', labels: ['AI & ML', 'Fintech', 'Health', 'Climate', 'SaaS', 'Cyber', 'Web3', 'EdTech', 'Other'],
        values: [72, 46, 38, 31, 28, 24, 18, 12, 18],
        hole: 0.52, marker: { colors: ['#1B2A4A', '#C4553A', '#2E7D6F', '#C49B3C', '#415A77', '#6B4226', '#778DA9', '#A8BCCF', '#DFE3EA'], line: { color: '#fff', width: 1.5 } },
        textinfo: 'percent', textposition: 'inside', textfont: { size: 8, color: '#fff' },
        sort: false, direction: 'clockwise', rotation: -30, pull: [0.04, 0, 0, 0, 0, 0, 0, 0, 0], hoverinfo: 'label+value+percent'
    }], pieL({ annotations: [{ text: '<b>$287B</b>', showarrow: false, font: { family: ff, size: 12, color: '#1B2A4A' }, x: 0.5, y: 0.5 }] }), cfg);

    // --- Plotly Tab Charts ---

    // 3D Surface Plot
    if (document.getElementById('gc-plotly-surface')) {
        var _sz = 25, _sData = [];
        for (var _si = 0; _si < _sz; _si++) { _sData[_si] = []; for (var _sj = 0; _sj < _sz; _sj++) { _sData[_si][_sj] = Math.sin((_si / _sz) * 3.14 * 2) * Math.cos((_sj / _sz) * 3.14 * 2) * 5 + Math.random(); } }
        Plotly.newPlot('gc-plotly-surface', [{ z: _sData, type: 'surface', colorscale: [[0, '#1B2A4A'], [0.5, '#2E7D6F'], [1, '#C49B3C']], showscale: false }], { margin: { l: 0, r: 0, t: 0, b: 0 }, scene: { xaxis: { showticklabels: false }, yaxis: { showticklabels: false }, zaxis: { showticklabels: false } }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)' }, cfg);
    }

    // Radar / Spider Chart
    if (document.getElementById('gc-plotly-radar')) {
        var _radarCats = ['Growth', 'Value', 'Momentum', 'Quality', 'Volatility', 'Yield'];
        Plotly.newPlot('gc-plotly-radar', [
            { type: 'scatterpolar', r: [85, 62, 78, 90, 45, 55, 85], theta: _radarCats.concat([_radarCats[0]]), fill: 'toself', fillcolor: 'rgba(27,42,74,0.2)', line: { color: '#1B2A4A', width: 2 }, name: 'Tech' },
            { type: 'scatterpolar', r: [40, 88, 55, 72, 30, 82, 40], theta: _radarCats.concat([_radarCats[0]]), fill: 'toself', fillcolor: 'rgba(46,125,111,0.15)', line: { color: '#2E7D6F', width: 2 }, name: 'Utilities' },
            { type: 'scatterpolar', r: [65, 75, 82, 60, 68, 42, 65], theta: _radarCats.concat([_radarCats[0]]), fill: 'toself', fillcolor: 'rgba(196,155,60,0.15)', line: { color: '#C49B3C', width: 2, dash: 'dot' }, name: 'Finance' }
        ], L({ polar: { radialaxis: { visible: true, range: [0, 100], tickfont: { size: 11 } }, angularaxis: { tickfont: { size: 11 } } }, showlegend: true, legend: { font: { size: 11 } } }), cfg);
    }

    // Sunburst Chart
    if (document.getElementById('gc-plotly-sunburst')) {
        Plotly.newPlot('gc-plotly-sunburst', [{ type: 'sunburst', labels: ['Market', 'Tech', 'Health', 'Finance', 'Energy', 'AAPL', 'MSFT', 'NVDA', 'JNJ', 'PFE', 'JPM', 'GS', 'XOM', 'CVX'], parents: ['', 'Market', 'Market', 'Market', 'Market', 'Tech', 'Tech', 'Tech', 'Health', 'Health', 'Finance', 'Finance', 'Energy', 'Energy'], values: [90, 35, 18, 22, 15, 14, 12, 9, 10, 8, 12, 10, 9, 6], branchvalues: 'total', marker: { colors: ['', '#1B2A4A', '#2E7D6F', '#C49B3C', '#C4553A', '#2563eb', '#3b82f6', '#60a5fa', '#059669', '#34d399', '#d97706', '#f59e0b', '#dc2626', '#ef4444'] }, textfont: { size: 11 } }], L({ margin: { l: 5, r: 5, t: 5, b: 5 } }), cfg);
    }

    // Treemap
    if (document.getElementById('gc-plotly-treemap')) {
        Plotly.newPlot('gc-plotly-treemap', [{ type: 'treemap', labels: ['Portfolio', 'US Equity', 'Intl Equity', 'Fixed Income', 'Alts', 'Large Cap', 'Mid Cap', 'Small Cap', 'Developed', 'Emerging', 'Govt Bond', 'Corp Bond', 'Real Estate', 'Commodities'], parents: ['', 'Portfolio', 'Portfolio', 'Portfolio', 'Portfolio', 'US Equity', 'US Equity', 'US Equity', 'Intl Equity', 'Intl Equity', 'Fixed Income', 'Fixed Income', 'Alts', 'Alts'], values: [100, 40, 20, 25, 15, 22, 12, 6, 14, 6, 15, 10, 8, 7], branchvalues: 'total', marker: { colors: ['', '#1B2A4A', '#2E7D6F', '#C49B3C', '#C4553A', '#2563eb', '#3b82f6', '#60a5fa', '#059669', '#34d399', '#d97706', '#f59e0b', '#dc2626', '#ef4444'] }, textfont: { size: 11 } }], L({ margin: { l: 5, r: 5, t: 5, b: 5 } }), cfg);
    }

    // Waterfall Chart
    if (document.getElementById('gc-plotly-waterfall')) {
        Plotly.newPlot('gc-plotly-waterfall', [{ type: 'waterfall', orientation: 'v', x: ['Revenue', 'COGS', 'Gross Profit', 'OpEx', 'R&D', 'EBITDA', 'D&A', 'EBIT', 'Interest', 'Tax', 'Net Income'], y: [380, -142, null, -68, -45, null, -18, null, -8, -25, null], measure: ['absolute', 'relative', 'total', 'relative', 'relative', 'total', 'relative', 'total', 'relative', 'relative', 'total'], connector: { line: { color: '#778DA9', width: 1 } }, increasing: { marker: { color: '#2E7D6F' } }, decreasing: { marker: { color: '#C4553A' } }, totals: { marker: { color: '#1B2A4A' } }, textfont: { size: 11 } }], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 } }, xaxis: { tickfont: { size: 11 } } }), cfg);
    }

    // Funnel Chart
    if (document.getElementById('gc-plotly-funnel')) {
        Plotly.newPlot('gc-plotly-funnel', [{ type: 'funnel', y: ['Leads', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won'], x: [12500, 6800, 3200, 1800, 920], marker: { color: ['#1B2A4A', '#2E7D6F', '#C49B3C', '#C4553A', '#3B82F6'] }, textinfo: 'value+percent total', textfont: { size: 11 } }], L({ margin: { l: 80 }, yaxis: { tickfont: { size: 11 } } }), cfg);
    }

    // Gauge / Indicator
    if (document.getElementById('gc-plotly-gauge')) {
        Plotly.newPlot('gc-plotly-gauge', [{ type: 'indicator', mode: 'gauge+number+delta', value: 72.4, title: { text: 'Market Sentiment', font: { size: 12 } }, delta: { reference: 65, increasing: { color: '#2E7D6F' }, decreasing: { color: '#C4553A' }, font: { size: 11 } }, number: { font: { size: 18 } }, gauge: { axis: { range: [0, 100], tickfont: { size: 11 } }, bar: { color: '#1B2A4A' }, steps: [{ range: [0, 30], color: 'rgba(196,85,58,0.2)' }, { range: [30, 70], color: 'rgba(196,155,60,0.2)' }, { range: [70, 100], color: 'rgba(46,125,111,0.2)' }], threshold: { line: { color: '#C4553A', width: 3 }, thickness: 0.75, value: 80 } } }], L({ margin: { t: 40, b: 10, l: 25, r: 25 } }), cfg);
    }

    // Polar Area
    if (document.getElementById('gc-plotly-polar')) {
        Plotly.newPlot('gc-plotly-polar', [{ type: 'barpolar', r: [42, 38, 28, 35, 48, 52, 45, 30], theta: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], marker: { color: ['#1B2A4A', '#2E7D6F', '#C49B3C', '#C4553A', '#3B82F6', '#778DA9', '#059669', '#A8BCCF'], opacity: 0.8 } }], L({ polar: { radialaxis: { tickfont: { size: 11 }, showline: false }, angularaxis: { tickfont: { size: 11 } } } }), cfg);
    }

    // Violin Plot
    if (document.getElementById('gc-plotly-violin')) {
        var _genViolin = function (mu, sigma, n) { var d = []; for (var i = 0; i < n; i++) { var u1 = Math.random(), u2 = Math.random(); d.push(mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * 3.14159 * u2)); } return d; };
        Plotly.newPlot('gc-plotly-violin', [
            { type: 'violin', y: _genViolin(8, 15, 100), name: 'Tech', marker: { color: '#1B2A4A' }, box: { visible: true }, meanline: { visible: true } },
            { type: 'violin', y: _genViolin(5, 8, 100), name: 'Utils', marker: { color: '#2E7D6F' }, box: { visible: true }, meanline: { visible: true } },
            { type: 'violin', y: _genViolin(6, 12, 100), name: 'Finance', marker: { color: '#C49B3C' }, box: { visible: true }, meanline: { visible: true } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 }, ticksuffix: '%', zeroline: true, zerolinecolor: '#ccc' } }), cfg);
    }

    // Sankey Flow
    if (document.getElementById('gc-plotly-sankey')) {
        Plotly.newPlot('gc-plotly-sankey', [{ type: 'sankey', node: { label: ['Retail', 'Institutional', 'Pension', 'US Equity', 'Intl Equity', 'Bonds', 'REIT', 'MMF'], color: ['#1B2A4A', '#2E7D6F', '#C49B3C', '#3B82F6', '#059669', '#d97706', '#C4553A', '#778DA9'], pad: 15, thickness: 15 }, link: { source: [0, 0, 0, 1, 1, 1, 2, 2, 2], target: [3, 5, 7, 3, 4, 5, 3, 4, 6], value: [120, 80, 40, 200, 150, 100, 180, 90, 50], color: 'rgba(168,188,207,0.3)' } }], L({ margin: { l: 5, r: 5, t: 5, b: 5 } }), cfg);
    }

    // Contour Plot
    if (document.getElementById('gc-plotly-contour')) {
        var _cz = [];
        for (var _ci = 0; _ci < 20; _ci++) { _cz[_ci] = []; for (var _cj = 0; _cj < 20; _cj++) { _cz[_ci][_cj] = 20 + 15 * Math.exp(-(((_ci - 10) * (_ci - 10) + (_cj - 10) * (_cj - 10)) / 50)) + Math.random() * 3; } }
        Plotly.newPlot('gc-plotly-contour', [{ z: _cz, type: 'contour', colorscale: [[0, '#1B2A4A'], [0.5, '#2E7D6F'], [1, '#C49B3C']], showscale: false, contours: { coloring: 'heatmap' } }], L({ xaxis: { title: { text: 'Strike', font: { size: 11 } }, tickfont: { size: 11 } }, yaxis: { title: { text: 'Expiry', font: { size: 11 } }, tickfont: { size: 11 } } }), cfg);
    }

    // Parallel Coordinates
    if (document.getElementById('gc-plotly-parcoords')) {
        Plotly.newPlot('gc-plotly-parcoords', [{ type: 'parcoords', line: { color: [1, 2, 3, 4, 5, 6, 7, 8], colorscale: [[0, '#1B2A4A'], [0.5, '#2E7D6F'], [1, '#C49B3C']] }, dimensions: [{ label: 'PE', values: [29, 63, 35, 78, 28, 25, 12, 24], range: [10, 80] }, { label: 'Beta', values: [1.21, 1.68, 0.91, 2.05, 1.24, 1.06, 1.08, 1.15], range: [0.5, 2.5] }, { label: 'Yield %', values: [0.52, 0.02, 0.72, 0, 0.36, 0.47, 2.24, 0], range: [0, 3] }, { label: 'RSI', values: [58, 72, 53, 44, 61, 58, 50, 56], range: [30, 80] }, { label: 'Mkt Cap B', values: [2980, 2160, 3080, 791, 1280, 1750, 573, 1890], range: [400, 3200] }] }], L({ margin: { l: 40, r: 30, t: 10, b: 30 } }), cfg);
    }

    // Bubble Chart - Market Cap vs PE vs Revenue
    if (document.getElementById('gc-plotly-bubble')) {
        var _bNames = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'JNJ', 'WMT', 'PG'];
        var _bPE = [29, 35, 25, 62, 68, 28, 78, 12, 31, 24, 28, 26];
        var _bMcap = [2980, 2800, 1950, 1850, 1680, 1250, 791, 540, 520, 380, 410, 365];
        var _bRev = [394, 220, 305, 575, 61, 135, 97, 143, 32, 85, 648, 82];
        Plotly.newPlot('gc-plotly-bubble', [{
            x: _bPE, y: _bMcap, text: _bNames, mode: 'markers+text',
            textposition: 'top center', textfont: { size: 9, color: '#415A77' },
            marker: { size: _bRev.map(function (r) { return Math.sqrt(r) * 2.5; }), color: _bPE, colorscale: [[0, '#2E7D6F'], [0.5, '#C49B3C'], [1, '#C4553A']], opacity: 0.75, line: { color: '#1B2A4A', width: 1 } }
        }], L({ xaxis: { title: { text: 'P/E Ratio', font: { size: 10 } }, gridcolor: '#EDF0F4', tickfont: { size: 10 } }, yaxis: { title: { text: 'Market Cap ($B)', font: { size: 10 } }, gridcolor: '#EDF0F4', tickfont: { size: 10 } }, margin: { t: 10, b: 35, l: 45, r: 10 } }), cfg);
    }

    // Histogram - Daily Return Distribution
    if (document.getElementById('gc-plotly-histogram')) {
        var _histData = []; for (var _hi = 0; _hi < 500; _hi++) { var _u1 = Math.random(), _u2 = Math.random(); _histData.push(0.05 + 1.2 * Math.sqrt(-2 * Math.log(_u1)) * Math.cos(2 * 3.14159 * _u2)); }
        Plotly.newPlot('gc-plotly-histogram', [{
            x: _histData, type: 'histogram', nbinsx: 40,
            marker: { color: 'rgba(27,42,74,0.7)', line: { color: '#1B2A4A', width: 1 } }
        }], L({ xaxis: { title: { text: 'Daily Return %', font: { size: 10 } }, gridcolor: '#EDF0F4', tickfont: { size: 10 } }, yaxis: { title: { text: 'Frequency', font: { size: 10 } }, gridcolor: '#EDF0F4', tickfont: { size: 10 } }, bargap: 0.05, margin: { t: 10, b: 35, l: 35, r: 10 } }), cfg);
    }

    // Box Plot - Sector Monthly Returns
    if (document.getElementById('gc-plotly-boxplot')) {
        var _boxGen = function (mu, sig, n) { var d = []; for (var i = 0; i < n; i++) { var u = Math.random(), v = Math.random(); d.push(mu + sig * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * 3.14159 * v)); } return d; };
        Plotly.newPlot('gc-plotly-boxplot', [
            { y: _boxGen(1.2, 4.5, 60), type: 'box', name: 'Tech', marker: { color: '#1B2A4A' }, boxmean: 'sd' },
            { y: _boxGen(0.8, 2.1, 60), type: 'box', name: 'Health', marker: { color: '#2E7D6F' }, boxmean: 'sd' },
            { y: _boxGen(0.6, 3.2, 60), type: 'box', name: 'Finance', marker: { color: '#C49B3C' }, boxmean: 'sd' },
            { y: _boxGen(0.3, 1.8, 60), type: 'box', name: 'Utils', marker: { color: '#778DA9' }, boxmean: 'sd' },
            { y: _boxGen(0.9, 5.0, 60), type: 'box', name: 'Energy', marker: { color: '#C4553A' }, boxmean: 'sd' }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 10 }, ticksuffix: '%', zeroline: true, zerolinecolor: '#ccc' }, margin: { t: 10, b: 25, l: 35, r: 10 } }), cfg);
    }

    // Normal Distribution / Bell Curve
    if (document.getElementById('gc-plotly-normal')) {
        var _nx = [], _ny1 = [], _ny2 = [], _ny3 = [];
        for (var _ni = -40; _ni <= 40; _ni++) {
            var x = _ni * 0.1;
            _nx.push(x);
            _ny1.push(Math.exp(-x * x / 2) / Math.sqrt(2 * 3.14159));
            _ny2.push(Math.exp(-x * x / (2 * 0.5 * 0.5)) / (0.5 * Math.sqrt(2 * 3.14159)));
            _ny3.push(Math.exp(-x * x / (2 * 2 * 2)) / (2 * Math.sqrt(2 * 3.14159)));
        }
        Plotly.newPlot('gc-plotly-normal', [
            { x: _nx, y: _ny1, name: 'sigma=1', fill: 'tozeroy', fillcolor: 'rgba(27,42,74,0.15)', line: { color: '#1B2A4A', width: 2.5 } },
            { x: _nx, y: _ny2, name: 'sigma=0.5', fill: 'tozeroy', fillcolor: 'rgba(196,85,58,0.1)', line: { color: '#C4553A', width: 2, dash: 'dash' } },
            { x: _nx, y: _ny3, name: 'sigma=2', fill: 'tozeroy', fillcolor: 'rgba(46,125,111,0.1)', line: { color: '#2E7D6F', width: 2, dash: 'dot' } }
        ], L({ xaxis: { gridcolor: '#EDF0F4', tickfont: { size: 10 }, title: { text: 'x', font: { size: 10 } } }, yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 10 }, title: { text: 'f(x)', font: { size: 10 } } }, showlegend: true, legend: { font: { size: 9 }, x: 0.7, y: 0.95 }, margin: { t: 10, b: 35, l: 35, r: 10 } }), cfg);
    }

    // Correlation Matrix
    if (document.getElementById('gc-plotly-corrmatrix')) {
        var _cmLabels = ['SPY', 'QQQ', 'DIA', 'IWM', 'EFA', 'TLT', 'GLD', 'VNQ'];
        var _cmData = [
            [1.00, 0.92, 0.96, 0.88, 0.78, -.42, 0.12, 0.65],
            [0.92, 1.00, 0.85, 0.82, 0.72, -.48, 0.08, 0.58],
            [0.96, 0.85, 1.00, 0.86, 0.80, -.38, 0.15, 0.68],
            [0.88, 0.82, 0.86, 1.00, 0.74, -.35, 0.10, 0.72],
            [0.78, 0.72, 0.80, 0.74, 1.00, -.28, 0.22, 0.55],
            [-.42, -.48, -.38, -.35, -.28, 1.00, 0.32, -.15],
            [0.12, 0.08, 0.15, 0.10, 0.22, 0.32, 1.00, 0.18],
            [0.65, 0.58, 0.68, 0.72, 0.55, -.15, 0.18, 1.00]
        ];
        Plotly.newPlot('gc-plotly-corrmatrix', [{
            z: _cmData, x: _cmLabels, y: _cmLabels, type: 'heatmap',
            colorscale: [[0, '#C4553A'], [0.5, '#F6F7F9'], [1, '#1B2A4A']], zmin: -1, zmax: 1,
            text: _cmData.map(function (r) { return r.map(function (v) { return v.toFixed(2); }); }),
            texttemplate: '%{text}', textfont: { size: 8 }, showscale: false
        }], L({ xaxis: { tickfont: { size: 9 }, tickangle: -45 }, yaxis: { tickfont: { size: 9 }, autorange: 'reversed' }, margin: { t: 5, b: 35, l: 35, r: 5 } }), cfg);
    }

    // Regression Plot
    if (document.getElementById('gc-plotly-regression')) {
        var _rx = [], _ry = [], _rLine = [];
        for (var _ri = 0; _ri < 50; _ri++) {
            var xv = Math.random() * 10;
            _rx.push(xv);
            _ry.push(2.3 * xv + 5 + (Math.random() - 0.5) * 8);
        }
        _rx.sort(function (a, b) { return a - b; });
        var _rXsort = _rx.slice().sort(function (a, b) { return a - b; });
        _rLine = _rXsort.map(function (x) { return 2.3 * x + 5; });
        Plotly.newPlot('gc-plotly-regression', [
            { x: _rx, y: _ry, mode: 'markers', type: 'scatter', marker: { color: '#1B2A4A', size: 5, opacity: 0.6 }, name: 'Data' },
            { x: _rXsort, y: _rLine, mode: 'lines', line: { color: '#C4553A', width: 2.5, dash: 'dash' }, name: 'y = 2.3x + 5' },
            { x: _rXsort, y: _rXsort.map(function (x) { return 2.3 * x + 5 + 6; }), mode: 'lines', line: { color: 'rgba(196,85,58,0.2)', width: 1 }, showlegend: false },
            { x: _rXsort, y: _rXsort.map(function (x) { return 2.3 * x + 5 - 6; }), mode: 'lines', line: { color: 'rgba(196,85,58,0.2)', width: 1 }, fill: 'tonexty', fillcolor: 'rgba(196,85,58,0.06)', showlegend: false }
        ], L({ xaxis: { gridcolor: '#EDF0F4', tickfont: { size: 10 }, title: { text: 'X', font: { size: 10 } } }, yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 10 }, title: { text: 'Y', font: { size: 10 } } }, showlegend: true, legend: { font: { size: 9 }, x: 0.02, y: 0.98 }, margin: { t: 10, b: 35, l: 35, r: 10 } }), cfg);
    }

    // Social Sentiment Bubble Chart
    if (document.getElementById('gc-social-sentiment-bubble')) {
        var _ssPlatforms = ['X / Twitter', 'Reddit', 'StockTwits', 'YouTube', 'News'];
        var _ssBullish = [82, 79, 74, 61, 68];
        var _ssSignal = [72, 52, 62, 40, 44];
        var _ssMentions = [4200, 3100, 1800, 1200, 2400];
        var _ssColors = ['#3b82f6', '#22c55e', '#ec4899', '#ef4444', '#8b5cf6'];
        var _ssBorderColors = ['rgba(59,130,246,0.5)', 'rgba(34,197,94,0.5)', 'rgba(236,72,153,0.5)', 'rgba(239,68,68,0.5)', 'rgba(139,92,246,0.5)'];
        var _ssTraces = [];
        for (var _ssi = 0; _ssi < _ssPlatforms.length; _ssi++) {
            _ssTraces.push({
                x: [_ssBullish[_ssi]],
                y: [_ssSignal[_ssi]],
                mode: 'markers+text',
                text: [_ssPlatforms[_ssi] + '<br>' + _ssBullish[_ssi] + '%'],
                textposition: 'middle center',
                textfont: { size: 10, color: _ssColors[_ssi], family: 'Inter, system-ui, sans-serif' },
                marker: {
                    size: [Math.sqrt(_ssMentions[_ssi]) * 1.5],
                    color: ['rgba(255,255,255,0.01)'],
                    line: { color: _ssColors[_ssi], width: 1.5 },
                    opacity: 1
                },
                name: _ssPlatforms[_ssi],
                showlegend: false,
                hovertemplate: '<b>' + _ssPlatforms[_ssi] + '</b><br>Bullish: ' + _ssBullish[_ssi] + '%<br>Signal: ' + _ssSignal[_ssi] + '<br>Mentions: ' + _ssMentions[_ssi].toLocaleString() + '<extra></extra>'
            });
        }
        Plotly.newPlot('gc-social-sentiment-bubble', _ssTraces, {
            paper_bgcolor: 'rgba(255,255,255,0)',
            plot_bgcolor: 'rgba(255,255,255,0)',
            font: { family: 'Inter, system-ui, sans-serif', size: 11, color: '#64748b' },
            margin: { t: 10, b: 45, l: 50, r: 20 },
            showlegend: false,
            xaxis: {
                title: { text: 'Bullish score (%)', font: { size: 11, color: '#94a3b8' }, standoff: 10 },
                range: [38, 102],
                showgrid: true,
                gridcolor: '#f1f5f9',
                gridwidth: 1,
                linecolor: '#e2e8f0',
                tickfont: { size: 10, color: '#94a3b8' },
                ticksuffix: '%',
                dtick: 10,
                zeroline: false
            },
            yaxis: {
                title: { text: 'Signal strength', font: { size: 11, color: '#94a3b8' }, standoff: 10 },
                range: [5, 102],
                showgrid: true,
                gridcolor: '#f1f5f9',
                gridwidth: 1,
                linecolor: '#e2e8f0',
                tickfont: { size: 10, color: '#94a3b8' },
                dtick: 20,
                zeroline: false
            },
            hoverlabel: { bgcolor: '#1e293b', font: { family: 'Inter, system-ui, sans-serif', size: 11, color: '#fff' }, bordercolor: 'transparent' }
        }, cfg);
    }

    // Social Sentiment Bubble Chart (Relevant tab instance)
    _renderSocialSentimentBubble('gc-social-sentiment-bubble-relevant');

    // --- PREDICTION MODELS ---
    // Moved to renderPredictionsCharts()
}

// Shared renderer for Social Sentiment Bubble Chart (can target either instance)
function _renderSocialSentimentBubble(elId) {
    if (!document.getElementById(elId)) return;
    var cfg = _plotlyCfg;
    var _ssPlatforms = ['X / Twitter', 'Reddit', 'StockTwits', 'YouTube', 'News'];
    var _ssBullish = [82, 79, 74, 61, 68];
    var _ssSignal = [72, 52, 62, 40, 44];
    var _ssMentions = [4200, 3100, 1800, 1200, 2400];
    var _ssColors = ['#3b82f6', '#22c55e', '#ec4899', '#ef4444', '#8b5cf6'];
    var _ssTraces = [];
    for (var _ssi = 0; _ssi < _ssPlatforms.length; _ssi++) {
        _ssTraces.push({
            x: [_ssBullish[_ssi]],
            y: [_ssSignal[_ssi]],
            mode: 'markers+text',
            text: [_ssPlatforms[_ssi] + '<br>' + _ssBullish[_ssi] + '%'],
            textposition: 'middle center',
            textfont: { size: 10, color: _ssColors[_ssi], family: 'Inter, system-ui, sans-serif' },
            marker: {
                size: [Math.sqrt(_ssMentions[_ssi]) * 1.5],
                color: ['rgba(255,255,255,0.01)'],
                line: { color: _ssColors[_ssi], width: 1.5 },
                opacity: 1
            },
            name: _ssPlatforms[_ssi],
            showlegend: false,
            hovertemplate: '<b>' + _ssPlatforms[_ssi] + '</b><br>Bullish: ' + _ssBullish[_ssi] + '%<br>Signal: ' + _ssSignal[_ssi] + '<br>Mentions: ' + _ssMentions[_ssi].toLocaleString() + '<extra></extra>'
        });
    }
    Plotly.newPlot(elId, _ssTraces, {
        paper_bgcolor: 'rgba(255,255,255,0)',
        plot_bgcolor: 'rgba(255,255,255,0)',
        font: { family: 'Inter, system-ui, sans-serif', size: 11, color: '#64748b' },
        margin: { t: 10, b: 45, l: 50, r: 20 },
        showlegend: false,
        xaxis: {
            title: { text: 'Bullish score (%)', font: { size: 11, color: '#94a3b8' }, standoff: 10 },
            range: [38, 102],
            showgrid: true, gridcolor: '#f1f5f9', gridwidth: 1, linecolor: '#e2e8f0',
            tickfont: { size: 10, color: '#94a3b8' }, ticksuffix: '%', dtick: 10, zeroline: false
        },
        yaxis: {
            title: { text: 'Signal strength', font: { size: 11, color: '#94a3b8' }, standoff: 10 },
            range: [5, 102],
            showgrid: true, gridcolor: '#f1f5f9', gridwidth: 1, linecolor: '#e2e8f0',
            tickfont: { size: 10, color: '#94a3b8' }, dtick: 20, zeroline: false
        },
        hoverlabel: { bgcolor: '#1e293b', font: { family: 'Inter, system-ui, sans-serif', size: 11, color: '#fff' }, bordercolor: 'transparent' }
    }, cfg);
}

// Standalone function to render social sentiment in the Relevant tab on demand
function renderRelevantSocialSentiment() {
    if (typeof Plotly !== 'undefined') {
        _renderSocialSentimentBubble('gc-social-sentiment-bubble-relevant');
    }
}

// Render Blockchain Hash Rate and Mempool charts
function renderRelevantBlockchain() {
    if (typeof Plotly === 'undefined') return;
    
    var cfg = _plotlyCfg || { displayModeBar: false, responsive: true };
    var margin = { t: 10, b: 24, l: 40, r: 10 };
    var font = { family: 'Inter, system-ui, sans-serif', size: 10, color: '#64748b' };

    function fetchAndRenderChart(chartName, elementId, summaryId, title, lineColor, formatValue) {
        var el = document.getElementById(elementId);
        var sumEl = document.getElementById(summaryId);
        if (!el) return;

        // Use the backend proxy for blockchain data
        var url = (typeof IntegrationRuntime !== 'undefined' ? IntegrationRuntime.toApiUrl('/api/blockchain/chart/') : '/api/blockchain/chart/') + chartName + '?timespan=1year';
        
        // Ensure authentication if we're using fetch directly
        var headers = {};
        var apiKey = localStorage.getItem('q4nt_api_key');
        if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

        fetch(url, { headers: headers })
            .then(function(res) {
                if (!res.ok) throw new Error('API Error ' + res.status);
                return res.json();
            })
            .then(function(data) {
                if (!data || !data.values || data.values.length === 0) throw new Error('No data returned');
                
                var x = [];
                var y = [];
                var lastVal = 0;
                
                data.values.forEach(function(point) {
                    x.push(new Date(point.x * 1000));
                    y.push(point.y);
                    lastVal = point.y;
                });
                
                var trace = {
                    x: x,
                    y: y,
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: lineColor, width: 2 },
                    fill: 'tozeroy',
                    fillcolor: lineColor.replace(')', ', 0.1)').replace('rgb', 'rgba'),
                    hovertemplate: '%{x|%b %d, %Y}<br><b>%{y}</b><extra></extra>'
                };
                
                var layout = {
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)',
                    margin: margin,
                    font: font,
                    xaxis: { gridcolor: '#1e293b', linecolor: '#334155', tickfont: font },
                    yaxis: { gridcolor: '#1e293b', linecolor: '#334155', tickfont: font, zeroline: false }
                };
                
                Plotly.newPlot(elementId, [trace], layout, cfg);
                
                if (sumEl) {
                    sumEl.textContent = 'Current ' + title + ': ' + (formatValue ? formatValue(lastVal) : lastVal);
                    sumEl.style.color = '#10b981'; // Success green
                }
            })
            .catch(function(err) {
                console.error('[Blockchain] Render error for ' + chartName + ':', err);
                if (sumEl) {
                    sumEl.textContent = 'Error loading ' + title;
                    sumEl.style.color = '#ef4444'; // Error red
                }
            });
    }

    // Formatters
    function formatHashRate(val) {
        // Values from API are usually in TH/s. Convert to EH/s for readability
        return (val / 1000000).toFixed(2) + ' EH/s';
    }
    
    function formatMempool(val) {
        // Bytes to MB
        return (val / (1024 * 1024)).toFixed(2) + ' MB';
    }

    fetchAndRenderChart('hash-rate', 'blockchain-hashrate-chart', 'blockchain-hashrate-summary', 'Hash Rate', 'rgb(245, 158, 11)', formatHashRate); // Orange
    fetchAndRenderChart('mempool-size', 'blockchain-mempool-chart', 'blockchain-mempool-summary', 'Mempool Size', 'rgb(59, 130, 246)', formatMempool); // Blue
}

function renderPredictionsCharts() {
    var cfg = _plotlyCfg;
    function L(extra) { return _plotlyL(extra); }

    if (document.getElementById('gc-pred-monte-carlo')) {
        var traces = [];
        for (var i=0; i<5; i++) {
            var y = [100];
            for(var step=1; step<30; step++) {
                y.push(y[step-1] * (1 + (Math.random()-0.48)*0.05));
            }
            traces.push({ y: y, type: 'scatter', mode: 'lines', line: { width: 1, color: 'rgba(59, 130, 246, 0.'+(3+i)+')' }});
        }
        Plotly.newPlot('gc-pred-monte-carlo', traces, L({ margin: {l:25, r:5, t:10, b:20}, showlegend: false }), cfg);
    }

    if (document.getElementById('gc-pred-arima')) {
        var hist = [10, 12, 11, 15, 14, 18, 17, 22];
        var pred = [null, null, null, null, null, null, null, 22, 23, 25, 24, 28];
        var upper = [null, null, null, null, null, null, null, 22, 26, 29, 28, 34];
        var lower = [null, null, null, null, null, null, null, 22, 20, 21, 20, 22];
        Plotly.newPlot('gc-pred-arima', [
            { y: hist, type: 'scatter', mode: 'lines', line: { color: '#C49B3C' }, name: 'Historical' },
            { y: pred, type: 'scatter', mode: 'lines', line: { color: '#3B82F6', dash: 'dash' }, name: 'Forecast' },
            { y: upper, type: 'scatter', mode: 'lines', line: { width: 0 }, showlegend: false },
            { y: lower, type: 'scatter', mode: 'lines', fill: 'tonexty', fillcolor: 'rgba(59,130,246,0.2)', line: { width: 0 }, name: '95% CI' }
        ], L({ margin: {l:25, r:5, t:10, b:20}, showlegend: false }), cfg);
    }

    if (document.getElementById('gc-pred-logistic')) {
        var x = [], y = [];
        for(var i=-5; i<=5; i+=0.5) { x.push(i); y.push(1 / (1 + Math.exp(-i))); }
        Plotly.newPlot('gc-pred-logistic', [
            { x: [-4, -3, -2, -1, 0, 1, 2, 3, 4], y: [0, 0, 0, 0, 1, 1, 1, 1, 1], mode: 'markers', marker: { size: 8, color: '#C4553A' }, name: 'Data' },
            { x: x, y: y, type: 'scatter', mode: 'lines', line: { color: '#2E7D6F' }, name: 'Curve' }
        ], L({ margin: {l:25, r:5, t:10, b:20}, showlegend: false }), cfg);
    }

    if (document.getElementById('gc-pred-prophet')) {
        Plotly.newPlot('gc-pred-prophet', [
            { y: [50, 52, 49, 53, 56, 55, 60, 58, 62, 65, 63, 68, 70], type: 'scatter', mode: 'markers+lines', marker: { color: '#A8BCCF' }, name: 'Actual' },
            { y: [48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72], type: 'scatter', mode: 'lines', line: { color: '#2563eb', width: 3 }, name: 'Trend' }
        ], L({ margin: {l:25, r:5, t:10, b:20}, showlegend: false }), cfg);
    }

    if (document.getElementById('gc-pred-kmeans')) {
        var c1x=[], c1y=[], c2x=[], c2y=[], c3x=[], c3y=[];
        for(var i=0; i<20; i++) {
            c1x.push(Math.random()*2+2); c1y.push(Math.random()*2+2);
            c2x.push(Math.random()*2+6); c2y.push(Math.random()*2+6);
            c3x.push(Math.random()*2+6); c3y.push(Math.random()*2+2);
        }
        Plotly.newPlot('gc-pred-kmeans', [
            { x: c1x, y: c1y, mode: 'markers', marker: { color: '#3B82F6' } },
            { x: c2x, y: c2y, mode: 'markers', marker: { color: '#1B2A4A' } },
            { x: c3x, y: c3y, mode: 'markers', marker: { color: '#2E7D6F' } }
        ], L({ margin: {l:25, r:5, t:10, b:20}, showlegend: false }), cfg);
    }

    if (document.getElementById('gc-pred-nn')) {
        Plotly.newPlot('gc-pred-nn', [{
            z: [[0, 1, 0], [1, 0.5, 1], [0.8, 1, 0.2]],
            type: 'heatmap', colorscale: 'Viridis', showscale: false
        }], L({ margin: {l:25, r:5, t:10, b:20} }), cfg);
    }

    if (document.getElementById('gc-pred-garch')) {
        Plotly.newPlot('gc-pred-garch', [{
            y: [0.1, 0.12, 0.2, 0.5, 0.4, 0.2, 0.15, 0.12, 0.1, 0.11], type: 'scatter', mode: 'lines', line: { color: '#C4553A', shape: 'spline' }, fill: 'tozeroy', fillcolor: 'rgba(196, 85, 58, 0.3)'
        }], L({ margin: {l:25, r:5, t:10, b:20} }), cfg);
    }

    if (document.getElementById('gc-pred-rf')) {
        Plotly.newPlot('gc-pred-rf', [{
            x: [0.45, 0.25, 0.15, 0.10, 0.05],
            y: ['Feature 1', 'Feature 2', 'Feature 3', 'Feature 4', 'Feature 5'],
            type: 'bar', orientation: 'h', marker: { color: '#1B2A4A' }
        }], L({ margin: {l:60, r:5, t:10, b:20} }), cfg);
    }

    if (document.getElementById('gc-pred-scatter')) {
        var sx = [], sy = [], sx2 = [], sy2 = [];
        for(var i=0; i<30; i++) {
            sx.push(Math.random()*10); sy.push(Math.random()*10 + 2);
            sx2.push(Math.random()*10 + 4); sy2.push(Math.random()*10 + 6);
        }
        Plotly.newPlot('gc-pred-scatter', [
            { x: sx, y: sy, mode: 'markers', type: 'scatter', marker: { color: '#3B82F6', size: 6 }, name: 'Class 0' },
            { x: sx2, y: sy2, mode: 'markers', type: 'scatter', marker: { color: '#C4553A', size: 6 }, name: 'Class 1' }
        ], L({ margin: {l:25, r:5, t:10, b:20}, showlegend: false }), cfg);
    }

    if (document.getElementById('gc-pred-lin-reg')) {
        var lrx=[], lry=[], lry_pred=[];
        for(var i=0; i<40; i++) {
            var x_val = Math.random()*20;
            lrx.push(x_val); lry.push(x_val * 1.5 + 5 + (Math.random()-0.5)*10);
        }
        lrx.sort(function(a,b){return a-b;});
        for(var i=0; i<lrx.length; i++) lry_pred.push(lrx[i] * 1.5 + 5);
        
        Plotly.newPlot('gc-pred-lin-reg', [
            { x: lrx, y: lry, mode: 'markers', marker: { color: '#778DA9', size: 5 }, name: 'Actual' },
            { x: lrx, y: lry_pred, mode: 'lines', line: { color: '#2E7D6F', width: 3 }, name: 'Regression' }
        ], L({ margin: {l:25, r:5, t:10, b:20}, showlegend: false }), cfg);
    }

    if (document.getElementById('gc-pred-corr-heat')) {
        Plotly.newPlot('gc-pred-corr-heat', [{
            z: [[1, 0.8, -0.4, 0.2], [0.8, 1, 0.1, 0.5], [-0.4, 0.1, 1, -0.8], [0.2, 0.5, -0.8, 1]],
            x: ['F1', 'F2', 'F3', 'F4'], y: ['F1', 'F2', 'F3', 'F4'],
            type: 'heatmap', colorscale: [[0, '#C4553A'], [0.5, '#F6F7F9'], [1, '#1B2A4A']], showscale: false
        }], L({ margin: {l:35, r:10, t:10, b:35} }), cfg);
    }

    if (document.getElementById('gc-pred-pair-plot')) {
        var s1=[], s2=[], s3=[];
        for(var i=0; i<40; i++) {
            s1.push(Math.random()*2); s2.push(Math.random()*4); s3.push(Math.random()*8);
        }
        Plotly.newPlot('gc-pred-pair-plot', [{
            type: 'splom', dimensions: [{label: 'A', values: s1}, {label: 'B', values: s2}, {label: 'C', values: s3}],
            marker: { color: '#1B2A4A', size: 3, opacity: 0.6 }
        }], L({ margin: {l:30, r:10, t:10, b:30} }), cfg);
    }

    if (document.getElementById('gc-pred-residual')) {
        var rx=[], ry=[];
        for(var i=0; i<50; i++) {
            rx.push(Math.random()*100); ry.push((Math.random()-0.5)*20);
        }
        Plotly.newPlot('gc-pred-residual', [
            { x: rx, y: ry, mode: 'markers', marker: { color: '#C49B3C', size: 5, opacity: 0.8 }, name: 'Residuals' },
            { x: [0, 100], y: [0, 0], mode: 'lines', line: { color: '#1B2A4A', dash: 'dash', width: 2 }, name: 'Zero Line' }
        ], L({ margin: {l:25, r:5, t:10, b:20}, showlegend: false }), cfg);
    }

    if (document.getElementById('gc-pred-box-violin')) {
        var d1=[], d2=[];
        for(var i=0; i<50; i++) { d1.push(Math.random()*10); d2.push(Math.random()*10 + 2); }
        Plotly.newPlot('gc-pred-box-violin', [
            { type: 'violin', y: d1, name: 'Control', marker: { color: '#2E7D6F' }, box: { visible: true }, meanline: { visible: true } },
            { type: 'violin', y: d2, name: 'Test', marker: { color: '#C4553A' }, box: { visible: true }, meanline: { visible: true } }
        ], L({ margin: {l:35, r:5, t:10, b:25}, showlegend: false }), cfg);
    }

    if (document.getElementById('gc-pred-decision-tree')) {
        Plotly.newPlot('gc-pred-decision-tree', [
            { x: [5, 2.5, null, 5, 7.5, null, 2.5, 1.25, null, 2.5, 3.75, null, 7.5, 6.25, null, 7.5, 8.75], 
              y: [10, 7.5, null, 10, 7.5, null, 7.5, 5, null, 7.5, 5, null, 7.5, 5, null, 7.5, 5], 
              mode: 'lines', line: { color: '#778DA9', width: 2 }, hoverinfo: 'none' },
            { x: [5, 2.5, 7.5, 1.25, 3.75, 6.25, 8.75], 
              y: [10, 7.5, 7.5, 5, 5, 5, 5], 
              mode: 'markers+text', 
              text: ['Score<5', 'Val>2', 'Yes', 'P=0.9', 'P=0.1', 'N/A', 'Done'], 
              textposition: 'bottom center', 
              textfont: {size: 8, color: '#1B2A4A'}, 
              marker: { size: 12, color: '#1B2A4A', line: {color: '#fff', width: 1} } }
        ], L({ margin: {l:10, r:10, t:20, b:20}, xaxis: { visible: false }, yaxis: { visible: false }, showlegend: false }), cfg);
    }
}


// ===== Global Tab Charts =====
// Renders Plotly charts for the Global tab's World Economics, Flight Data,
// and Shipping Data sub-tabs. Called lazily on first tab activation.
function renderGlobalCharts() {
    var cfg = _plotlyCfg;
    var ff = _plotlyFont;
    var navy5 = _plotlyNavy5;
    var warm5 = _plotlyWarm5;
    var teal5 = _plotlyTeal5;
    function L(extra) { return _plotlyL(extra); }
    function pieL(extra) { return _plotlyPieL(extra); }

    // --- World Economics ---

    // GDP Growth Rates - Grouped Bar
    var countries = ['USA', 'China', 'India', 'Germany', 'Japan', 'Brazil'];
    Plotly.newPlot('gc-econ-gdp', [
        { x: countries, y: [2.5, 5.2, 6.8, 0.9, 1.1, 2.9], name: '2024', type: 'bar', marker: { color: '#A8BCCF' } },
        { x: countries, y: [2.1, 4.8, 7.2, 1.3, 1.5, 3.2], name: '2025', type: 'bar', marker: { color: '#1B2A4A' } }
    ], L({ barmode: 'group', bargap: 0.25, bargroupgap: 0.08, yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false, ticksuffix: '%' } }), cfg);

    // Commodity Prices - Multi-line
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    Plotly.newPlot('gc-econ-commodity', [
        { x: months, y: [72, 74, 78, 82, 80, 76, 73, 71, 75, 79, 83, 81], name: 'Crude Oil', mode: 'lines+markers', line: { color: '#1B2A4A', width: 2 }, marker: { size: 3 } },
        { x: months, y: [1820, 1850, 1890, 1920, 1960, 2010, 2050, 2020, 1980, 1950, 1970, 2000], name: 'Gold', mode: 'lines+markers', line: { color: '#C49B3C', width: 2 }, marker: { size: 3 }, yaxis: 'y2' },
        { x: months, y: [3.8, 3.9, 4.1, 4.3, 4.5, 4.2, 4.0, 3.8, 3.7, 3.9, 4.1, 4.4], name: 'Copper', mode: 'lines+markers', line: { color: '#2E7D6F', width: 2 }, marker: { size: 3 } }
    ], L({ yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false, tickprefix: '$', title: { text: 'Oil/Copper', font: { size: 7 } } }, yaxis2: { overlaying: 'y', side: 'right', tickfont: { size: 8 }, tickprefix: '$', showgrid: false, title: { text: 'Gold', font: { size: 7 } } } }), cfg);

    // Network Usage - Live Cloudflare Radar data (no static fallback)
    if (document.getElementById('gc-econ-network')) {
        var _netLayout = L({
            yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false },
            annotations: [{ text: 'Loading Cloudflare Radar...', showarrow: false, font: { size: 10, color: '#999' }, xref: 'paper', yref: 'paper', x: 0.5, y: 0.5 }]
        });
        Plotly.newPlot('gc-econ-network', [], _netLayout, cfg);

        if (typeof CloudflareAPI !== 'undefined') {
            var _cfTraces = [];
            var _cfDone = 0;
            var _cfTotal = 2;

            function _cfMaybeUpdate() {
                _cfDone++;
                if (_cfDone >= _cfTotal) {
                    var finalLayout = L({ yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false } });
                    if (_cfTraces.length === 0) {
                        finalLayout.annotations = [{ text: 'No data - check Cloudflare API', showarrow: false, font: { size: 10, color: '#c44' }, xref: 'paper', yref: 'paper', x: 0.5, y: 0.5 }];
                    }
                    try { Plotly.react('gc-econ-network', _cfTraces, finalLayout, cfg); } catch (e) { /* element gone */ }
                }
            }

            // 1. HTTP Traffic timeseries (global, 7d)
            try {
                CloudflareAPI.trafficTimeseries({ dateRange: '7d' }).then(function (data) {
                    try {
                        var serie = data && data.result && data.result.serie_0;
                        if (serie && serie.timestamps && serie.values) {
                            _cfTraces.push({ x: serie.timestamps, y: serie.values.map(Number), name: 'HTTP Traffic', mode: 'lines', line: { color: '#1B2A4A', width: 2 } });
                        }
                    } catch (e) { console.warn('[Network] HTTP parse error', e); }
                    _cfMaybeUpdate();
                }).catch(function (e) { console.warn('[Network] HTTP fetch error', e); _cfMaybeUpdate(); });
            } catch (e) { _cfDone++; }

            // 2. DNS timeseries (global, 7d)
            try {
                CloudflareAPI.dnsTimeseries({ dateRange: '7d' }).then(function (data) {
                    try {
                        var serie = data && data.result && data.result.serie_0;
                        if (serie && serie.timestamps && serie.values) {
                            _cfTraces.push({ x: serie.timestamps, y: serie.values.map(Number), name: 'DNS Queries', mode: 'lines', line: { color: '#778DA9', width: 1.5, dash: 'dot' } });
                        }
                    } catch (e) { console.warn('[Network] DNS parse error', e); }
                    _cfMaybeUpdate();
                }).catch(function (e) { console.warn('[Network] DNS fetch error', e); _cfMaybeUpdate(); });
            } catch (e) { _cfDone++; }
        }
    } // end gc-econ-network guard


    // --- Additional World Economics Charts ---

    // Oil Price History - Area chart
    var _oilMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (document.getElementById('gc-econ-oil-hist')) {
        Plotly.newPlot('gc-econ-oil-hist', [
            { x: _oilMonths, y: [72, 74, 78, 82, 80, 76, 73, 71, 75, 79, 83, 81], name: 'WTI', fill: 'tozeroy', fillcolor: 'rgba(27,42,74,0.15)', line: { color: '#1B2A4A', width: 2 } },
            { x: _oilMonths, y: [76, 78, 82, 86, 84, 80, 77, 75, 79, 83, 87, 85], name: 'Brent', fill: 'tozeroy', fillcolor: 'rgba(46,125,111,0.12)', line: { color: '#2E7D6F', width: 2 } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 }, zeroline: false } }), cfg);
    }

    // Yield Curve - Line chart
    var _ycMat = ['3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'];
    if (document.getElementById('gc-econ-yield-curve')) {
        Plotly.newPlot('gc-econ-yield-curve', [
            { x: _ycMat, y: [5.38, 5.42, 5.12, 4.62, 4.38, 4.18, 4.22, 4.28, 4.52, 4.45], name: 'USA', mode: 'lines+markers', line: { color: '#1B2A4A', width: 2.5 }, marker: { size: 5 } },
            { x: _ycMat, y: [3.82, 3.68, 3.42, 2.85, 2.62, 2.42, 2.48, 2.52, 2.68, 2.72], name: 'Germany', mode: 'lines+markers', line: { color: '#2E7D6F', width: 2 }, marker: { size: 4 } },
            { x: _ycMat, y: [-0.02, 0.02, 0.08, 0.18, 0.28, 0.48, 0.62, 0.92, 1.42, 1.68], name: 'Japan', mode: 'lines+markers', line: { color: '#C49B3C', width: 2, dash: 'dot' }, marker: { size: 4 } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 }, zeroline: true, zerolinecolor: '#ccc', ticksuffix: '%' }, xaxis: { tickfont: { size: 11 } } }), cfg);
    }

    // PMI Heatmap
    if (document.getElementById('gc-econ-pmi-heat')) {
        Plotly.newPlot('gc-econ-pmi-heat', [{
            z: [[51.2, 50.8, 49.2, 48.5, 49.2, 49.8], [43.4, 44.2, 45.8, 46.2, 46.6, 47.1], [49.2, 49.6, 50.1, 50.4, 51.2, 50.1], [48.2, 47.8, 48.5, 49.2, 48.9, 49.1], [57.2, 56.8, 55.4, 56.1, 56.5, 57.2], [44.8, 45.2, 46.5, 47.1, 46.8, 47.1], [49.8, 50.2, 51.4, 50.8, 51.2, 50.5], [50.8, 51.2, 50.4, 49.8, 50.1, 50.6]],
            x: ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], y: ['USA', 'EU', 'China', 'Japan', 'India', 'UK', 'S.Korea', 'Brazil'], type: 'heatmap', colorscale: [[0, '#C4553A'], [0.5, '#FFF8E1'], [1, '#2E7D6F']], zmin: 42, zmax: 58, showscale: false
        }], L({ yaxis: { tickfont: { size: 11 } }, xaxis: { tickfont: { size: 11 } } }), cfg);
    }

    // FDI Flows - Horizontal bar
    if (document.getElementById('gc-econ-fdi-flows')) {
        Plotly.newPlot('gc-econ-fdi-flows', [
            { y: ['Singapore', 'UK', 'India', 'Brazil', 'China', 'USA'], x: [92, 67, 49, 62, 189, 285], type: 'bar', orientation: 'h', marker: { color: ['#778DA9', '#A8BCCF', '#C49B3C', '#2E7D6F', '#C4553A', '#1B2A4A'] } }
        ], L({ xaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 } }, yaxis: { tickfont: { size: 11 } }, bargap: 0.3 }), cfg);
    }

    // Debt Comparison - Grouped bar
    if (document.getElementById('gc-econ-debt-comp')) {
        Plotly.newPlot('gc-econ-debt-comp', [
            { x: ['Japan', 'Italy', 'USA', 'France', 'UK', 'India', 'Germany', 'China'], y: [256, 140, 120, 110, 95, 83, 64, 77], name: '2020', type: 'bar', marker: { color: '#A8BCCF' } },
            { x: ['Japan', 'Italy', 'USA', 'France', 'UK', 'India', 'Germany', 'China'], y: [263, 144, 123, 112, 101, 84, 64, 83], name: '2025', type: 'bar', marker: { color: '#1B2A4A' } }
        ], L({ barmode: 'group', bargap: 0.2, yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 }, ticksuffix: '%' } }), cfg);
    }

    // Trade Deficit - Diverging bar
    if (document.getElementById('gc-econ-trade-def')) {
        Plotly.newPlot('gc-econ-trade-def', [
            { x: ['USA', 'UK', 'India', 'France', 'Brazil', 'Turkey', 'Germany', 'China', 'Russia', 'S.Korea', 'Netherlands', 'Saudi'], y: [-810, -188, -122, -85, -42, -65, 242, 580, 145, 52, 98, 156], type: 'bar', marker: { color: [-810, -188, -122, -85, -42, -65, 242, 580, 145, 52, 98, 156].map(function (v) { return v < 0 ? '#C4553A' : '#2E7D6F'; }) } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 }, zeroline: true, zerolinecolor: '#888' } }), cfg);
    }

    // Inflation Trends - Multi-line
    if (document.getElementById('gc-econ-infl-trend')) {
        var _inflM = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        Plotly.newPlot('gc-econ-infl-trend', [
            { x: _inflM, y: [3.1, 3.2, 3.5, 3.4, 3.3, 3.0, 3.2, 3.7, 3.7, 3.2, 3.1, 2.9], name: 'USA', line: { color: '#1B2A4A', width: 2.5 } },
            { x: _inflM, y: [2.8, 2.6, 2.4, 2.4, 2.6, 2.5, 2.6, 2.9, 2.7, 2.4, 2.3, 2.4], name: 'EU', line: { color: '#2E7D6F', width: 2 } },
            { x: _inflM, y: [4.0, 4.1, 3.8, 3.2, 3.4, 3.6, 3.3, 2.8, 2.4, 2.2, 2.0, 2.1], name: 'UK', line: { color: '#C49B3C', width: 2, dash: 'dash' } },
            { x: _inflM, y: [3.3, 2.8, 2.7, 2.5, 2.8, 3.0, 3.3, 3.1, 2.8, 3.2, 2.7, 2.6], name: 'Japan', line: { color: '#C4553A', width: 1.5, dash: 'dot' } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 }, ticksuffix: '%' } }), cfg);
    }

    // Energy Mix - Stacked bar
    if (document.getElementById('gc-econ-energy-mix')) {
        var _emC = ['USA', 'China', 'Germany', 'India', 'Brazil', 'Japan'];
        Plotly.newPlot('gc-econ-energy-mix', [
            { x: _emC, y: [36, 60, 26, 55, 12, 32], name: 'Fossil', type: 'bar', marker: { color: '#4A5568' } },
            { x: _emC, y: [19, 5, 11, 3, 65, 4], name: 'Hydro', type: 'bar', marker: { color: '#2E7D6F' } },
            { x: _emC, y: [19, 2, 6, 4, 8, 6], name: 'Nuclear', type: 'bar', marker: { color: '#C49B3C' } },
            { x: _emC, y: [13, 16, 22, 10, 18, 12], name: 'Wind/Solar', type: 'bar', marker: { color: '#3B82F6' } },
            { x: _emC, y: [13, 17, 35, 28, 7, 46], name: 'Other', type: 'bar', marker: { color: '#A8BCCF' } }
        ], L({ barmode: 'stack', yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 }, ticksuffix: '%' }, legend: { font: { size: 11 } } }), cfg);
    }

    // Labor Trends - Dual axis
    if (document.getElementById('gc-econ-labor-trend')) {
        var _labM = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        Plotly.newPlot('gc-econ-labor-trend', [
            { x: _labM, y: [210, 185, 275, 315, 280, 245, 190, 175, 265, 225, 210, 195], name: 'NFP (K)', type: 'bar', marker: { color: 'rgba(27,42,74,0.6)' } },
            { x: _labM, y: [3.8, 3.7, 3.6, 3.5, 3.5, 3.6, 3.7, 3.8, 3.7, 3.7, 3.6, 3.7], name: 'Unemp %', yaxis: 'y2', mode: 'lines+markers', line: { color: '#C4553A', width: 2.5 }, marker: { size: 5 } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 } }, yaxis2: { overlaying: 'y', side: 'right', tickfont: { size: 11 }, ticksuffix: '%', showgrid: false } }), cfg);
    }

    // Container Index - Area
    if (document.getElementById('gc-econ-container')) {
        var _ciWeeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'];
        Plotly.newPlot('gc-econ-container', [
            { x: _ciWeeks, y: [3200, 3400, 3800, 4100, 4280, 4500, 4200, 3900, 4100, 4380, 4600, 4800], name: 'SHA-LAX', fill: 'tozeroy', fillcolor: 'rgba(27,42,74,0.12)', line: { color: '#1B2A4A', width: 2 } },
            { x: _ciWeeks, y: [2800, 3000, 3200, 3500, 3860, 4000, 3800, 3600, 3700, 3900, 4100, 4200], name: 'SHA-RTM', fill: 'tozeroy', fillcolor: 'rgba(46,125,111,0.1)', line: { color: '#2E7D6F', width: 2 } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 } } }), cfg);
    }

    // Crop Futures - Multi-line dual axis
    if (document.getElementById('gc-econ-crop-futures')) {
        var _cropM = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        Plotly.newPlot('gc-econ-crop-futures', [
            { x: _cropM, y: [580, 595, 610, 625, 615, 600, 590, 605, 620, 635, 612, 618], name: 'Wheat', mode: 'lines+markers', line: { color: '#C49B3C', width: 2 }, marker: { size: 4 } },
            { x: _cropM, y: [440, 445, 455, 465, 470, 460, 450, 448, 458, 462, 455, 458], name: 'Corn', mode: 'lines+markers', line: { color: '#2E7D6F', width: 2 }, marker: { size: 4 } },
            { x: _cropM, y: [1200, 1220, 1250, 1280, 1260, 1240, 1230, 1242, 1260, 1270, 1245, 1242], name: 'Soybeans', yaxis: 'y2', mode: 'lines+markers', line: { color: '#1B2A4A', width: 2 }, marker: { size: 4 } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 }, ticksuffix: 'c' }, yaxis2: { overlaying: 'y', side: 'right', tickfont: { size: 11 }, ticksuffix: 'c', showgrid: false } }), cfg);
    }

    // Currency Rates - Multi-line
    if (document.getElementById('gc-econ-fx-rates')) {
        var _fxM = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        Plotly.newPlot('gc-econ-fx-rates', [
            { x: _fxM, y: [1.08, 1.07, 1.09, 1.10, 1.08, 1.07, 1.09, 1.10, 1.11, 1.09, 1.08, 1.10], name: 'EUR/USD', line: { color: '#1B2A4A', width: 2.5 } },
            { x: _fxM, y: [1.27, 1.26, 1.28, 1.29, 1.27, 1.26, 1.28, 1.29, 1.31, 1.30, 1.28, 1.27], name: 'GBP/USD', line: { color: '#2E7D6F', width: 2 } },
            { x: _fxM, y: [0.68, 0.67, 0.66, 0.67, 0.68, 0.67, 0.66, 0.65, 0.66, 0.67, 0.68, 0.67], name: 'AUD/USD', line: { color: '#C49B3C', width: 2, dash: 'dash' } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 } } }), cfg);
    }

    // Poverty Trends - Bar + line
    if (document.getElementById('gc-econ-poverty')) {
        var _pvY = ['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024'];
        Plotly.newPlot('gc-econ-poverty', [
            { x: _pvY, y: [10.0, 9.5, 9.2, 8.6, 8.4, 9.4, 9.1, 8.5, 8.2, 7.8], name: 'Poverty %', type: 'bar', marker: { color: 'rgba(196,85,58,0.6)' } },
            { x: _pvY, y: [735, 700, 680, 650, 640, 720, 700, 660, 630, 600], name: 'People (M)', yaxis: 'y2', mode: 'lines+markers', line: { color: '#1B2A4A', width: 2.5 }, marker: { size: 5 } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 }, ticksuffix: '%' }, yaxis2: { overlaying: 'y', side: 'right', tickfont: { size: 11 }, showgrid: false } }), cfg);
    }

    // Emissions - Stacked area
    if (document.getElementById('gc-econ-emissions')) {
        var _emY2 = ['2018', '2019', '2020', '2021', '2022', '2023', '2024'];
        Plotly.newPlot('gc-econ-emissions', [
            { x: _emY2, y: [10200, 10500, 9800, 10800, 11200, 11472, 11600], name: 'China', stackgroup: 'one', fillcolor: 'rgba(196,85,58,0.5)', line: { color: '#C4553A', width: 0 } },
            { x: _emY2, y: [5200, 5100, 4700, 4900, 5050, 5007, 4950], name: 'USA', stackgroup: 'one', fillcolor: 'rgba(27,42,74,0.5)', line: { color: '#1B2A4A', width: 0 } },
            { x: _emY2, y: [2500, 2600, 2450, 2650, 2750, 2830, 2920], name: 'India', stackgroup: 'one', fillcolor: 'rgba(196,155,60,0.5)', line: { color: '#C49B3C', width: 0 } },
            { x: _emY2, y: [3800, 3750, 3500, 3650, 3700, 3680, 3620], name: 'Rest', stackgroup: 'one', fillcolor: 'rgba(168,188,207,0.5)', line: { color: '#A8BCCF', width: 0 } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 } } }), cfg);
    }

    // Shipping Routes - Bubble
    if (document.getElementById('gc-econ-shipping')) {
        Plotly.newPlot('gc-econ-shipping', [
            { x: ['BDI', 'BCI', 'BPI', 'BSI', 'BHSI', 'SCFI'], y: [1842, 2156, 1624, 1128, 892, 1456], mode: 'markers+text', text: ['BDI', 'BCI', 'BPI', 'BSI', 'BHSI', 'SCFI'], textposition: 'top center', textfont: { size: 11 }, marker: { size: [35, 40, 30, 25, 20, 28], color: ['#1B2A4A', '#2E7D6F', '#C49B3C', '#C4553A', '#778DA9', '#3B82F6'], opacity: 0.8 } }
        ], L({ yaxis: { gridcolor: '#EDF0F4', tickfont: { size: 11 }, zeroline: false }, xaxis: { tickfont: { size: 11 } } }), cfg);
    }

    // --- Flight Data ---

    // Airline Traffic Volume - Stacked Bar
    Plotly.newPlot('gc-flight-traffic', [
        { x: ['Q1', 'Q2', 'Q3', 'Q4'], y: [584, 620, 710, 680], name: 'Delta', type: 'bar', marker: { color: '#1B2A4A' } },
        { x: ['Q1', 'Q2', 'Q3', 'Q4'], y: [512, 548, 635, 590], name: 'United', type: 'bar', marker: { color: '#2E7D6F' } },
        { x: ['Q1', 'Q2', 'Q3', 'Q4'], y: [498, 530, 610, 575], name: 'American', type: 'bar', marker: { color: '#C49B3C' } },
        { x: ['Q1', 'Q2', 'Q3', 'Q4'], y: [462, 490, 580, 530], name: 'Southwest', type: 'bar', marker: { color: '#C4553A' } }
    ], L({ barmode: 'stack', yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false, ticksuffix: 'K' } }), cfg);

    // Flight Delay Statistics - Horizontal Bar
    var regions = ['S. America', 'N. America', 'Europe', 'Africa', 'Asia-Pac', 'Mid East'];
    var delays = [52, 42, 38, 35, 28, 18];
    Plotly.newPlot('gc-flight-delay', [{
        type: 'bar', orientation: 'h', x: delays, y: regions,
        marker: { color: delays.map(function (d) { return d > 40 ? '#C4553A' : d > 30 ? '#C49B3C' : '#2E7D6F'; }) },
        text: delays.map(function (d) { return d + ' min'; }), textposition: 'outside', textfont: { family: ff, size: 8, color: '#415A77' }
    }], L({ xaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false, ticksuffix: ' min' }, yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false, autorange: 'reversed' }, margin: { t: 4, b: 24, l: 60, r: 32 } }), cfg);

    // Route Heatmap - Heatmap
    var routes = ['Transatlantic', 'Transpacific', 'Europe-Asia', 'Intra-Asia', 'Mid East Hub', 'Africa'];
    var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    Plotly.newPlot('gc-flight-heatmap', [{
        type: 'heatmap', z: [
            [78, 82, 91, 85], [72, 76, 88, 80], [55, 60, 68, 62],
            [88, 92, 98, 94], [65, 70, 78, 72], [32, 35, 42, 38]
        ],
        x: quarters, y: routes,
        colorscale: [[0, '#D2F0EA'], [0.5, '#4AA391'], [1, '#1A4A3A']],
        showscale: false, hovertemplate: '%{y}<br>%{x}: %{z}K pax<extra></extra>',
        text: [
            ['78K', '82K', '91K', '85K'], ['72K', '76K', '88K', '80K'], ['55K', '60K', '68K', '62K'],
            ['88K', '92K', '98K', '94K'], ['65K', '70K', '78K', '72K'], ['32K', '35K', '42K', '38K']
        ],
        texttemplate: '%{text}', textfont: { size: 7, color: '#fff' }
    }], L({ margin: { t: 4, b: 24, l: 68, r: 8 }, yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 7 }, zeroline: false } }), cfg);

    // --- Shipping Data ---

    // Port Congestion Index - Bar
    var ports = ['Shanghai', 'Singapore', 'Rotterdam', 'LA/Long Bch', 'Hamburg', 'Busan'];
    var congestion = [8.4, 7.2, 5.8, 6.9, 4.5, 5.1];
    Plotly.newPlot('gc-ship-congestion', [{
        x: ports, y: congestion, type: 'bar',
        marker: { color: congestion.map(function (c) { return c > 7 ? '#C4553A' : c > 5.5 ? '#C49B3C' : '#2E7D6F'; }) },
        text: congestion.map(function (c) { return c.toFixed(1); }), textposition: 'outside', textfont: { family: ff, size: 8, color: '#415A77' }
    }], L({ yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false, range: [0, 10], title: { text: 'Index', font: { size: 7 } } } }), cfg);

    // Container Freight Rates - Multi-line
    var wks = ['W1', 'W4', 'W8', 'W12', 'W16', 'W20', 'W24', 'W28', 'W32', 'W36', 'W40', 'W44', 'W48', 'W52'];
    Plotly.newPlot('gc-ship-freight', [
        { x: wks, y: [2600, 2720, 2840, 2950, 3100, 3250, 3180, 3050, 2920, 2800, 2750, 2840, 2900, 2980], name: 'Asia-USWC', mode: 'lines', line: { color: '#1B2A4A', width: 2 } },
        { x: wks, y: [3200, 3350, 3500, 3560, 3700, 3820, 3750, 3600, 3480, 3350, 3300, 3400, 3500, 3560], name: 'Asia-USEC', mode: 'lines', line: { color: '#2E7D6F', width: 2 } },
        { x: wks, y: [1800, 1850, 1920, 1980, 2050, 2120, 2080, 2000, 1950, 1880, 1840, 1900, 1960, 2020], name: 'Asia-N.Eur', mode: 'lines', line: { color: '#C49B3C', width: 2 } },
        { x: wks, y: [600, 620, 650, 680, 720, 750, 740, 710, 690, 660, 640, 670, 700, 720], name: 'Intra-Asia', mode: 'lines', line: { color: '#C4553A', width: 2, dash: 'dot' } }
    ], L({ yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false, tickprefix: '$' } }), cfg);

    // Dry Bulk Index - Area + Lines
    var dMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    Plotly.newPlot('gc-ship-drybulk', [
        { x: dMonths, y: [1650, 1720, 1780, 1842, 1900, 1950, 1880, 1820, 1760, 1700, 1750, 1842], name: 'BDI', fill: 'tozeroy', line: { color: '#1B2A4A', width: 1.5 }, fillcolor: 'rgba(27,42,74,0.15)', mode: 'lines' },
        { x: dMonths, y: [2100, 2200, 2350, 2456, 2520, 2600, 2480, 2380, 2300, 2220, 2350, 2456], name: 'Capesize', mode: 'lines+markers', line: { color: '#2E7D6F', width: 1.5 }, marker: { size: 3 } },
        { x: dMonths, y: [1500, 1540, 1580, 1624, 1680, 1720, 1660, 1610, 1560, 1520, 1570, 1624], name: 'Panamax', mode: 'lines+markers', line: { color: '#C49B3C', width: 1.5 }, marker: { size: 3 } },
        { x: dMonths, y: [1200, 1220, 1260, 1286, 1320, 1350, 1310, 1280, 1240, 1210, 1250, 1286], name: 'Supramax', mode: 'lines+markers', line: { color: '#C4553A', width: 1.5 }, marker: { size: 3 } }
    ], L({ yaxis: { gridcolor: '#EDF0F4', linecolor: '#DFE3EA', tickfont: { size: 8 }, zeroline: false, title: { text: 'Points', font: { size: 7 } } } }), cfg);
}
