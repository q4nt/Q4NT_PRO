/* ==========================================================================
   Q4NT PRO - Watchlist Tab Controller
   ========================================================================== */
var TabWatchlist = (function() {
    var pane = document.querySelector('.btp-pane[data-pane="watchlist"]');
    
    if (pane) {
        pane.innerHTML = `
            <div style="padding: 10px; font-family: 'Inter', sans-serif;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid rgba(0,0,0,0.05); padding-bottom: 8px;">
                    <span style="font-weight: 600; font-size: 0.8rem; color: var(--text-main);">MARKET WATCHLIST</span>
                    <span style="font-size: 0.7rem; color: var(--accent);">+ ADD SYMBOL</span>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem;">
                    <thead>
                        <tr style="text-align: left; color: var(--text-dim); border-bottom: 1px solid rgba(0,0,0,0.03);">
                            <th style="padding: 4px 0; font-weight: 500;">SYMBOL</th>
                            <th style="padding: 4px 0; font-weight: 500;">LAST</th>
                            <th style="padding: 4px 0; font-weight: 500;">CHANGE</th>
                            <th style="padding: 4px 0; font-weight: 500;">VOL</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid rgba(0,0,0,0.02);">
                            <td style="padding: 8px 0; font-weight: 600;">BTC/USD</td>
                            <td style="padding: 8px 0;">64,210.50</td>
                            <td style="padding: 8px 0; color: #34C759;">+1.24%</td>
                            <td style="padding: 8px 0; color: var(--text-dim);">12.4B</td>
                        </tr>
                        <tr style="border-bottom: 1px solid rgba(0,0,0,0.02);">
                            <td style="padding: 8px 0; font-weight: 600;">ETH/USD</td>
                            <td style="padding: 8px 0;">3,450.12</td>
                            <td style="padding: 8px 0; color: #FF3B30;">-0.45%</td>
                            <td style="padding: 8px 0; color: var(--text-dim);">4.1B</td>
                        </tr>
                        <tr style="border-bottom: 1px solid rgba(0,0,0,0.02);">
                            <td style="padding: 8px 0; font-weight: 600;">SOL/USD</td>
                            <td style="padding: 8px 0;">145.82</td>
                            <td style="padding: 8px 0; color: #34C759;">+5.67%</td>
                            <td style="padding: 8px 0; color: var(--text-dim);">2.8B</td>
                        </tr>
                        <tr style="border-bottom: 1px solid rgba(0,0,0,0.02);">
                            <td style="padding: 8px 0; font-weight: 600;">AAPL</td>
                            <td style="padding: 8px 0;">189.45</td>
                            <td style="padding: 8px 0; color: #34C759;">+0.12%</td>
                            <td style="padding: 8px 0; color: var(--text-dim);">85M</td>
                        </tr>
                        <tr style="border-bottom: 1px solid rgba(0,0,0,0.02);">
                            <td style="padding: 8px 0; font-weight: 600;">TSLA</td>
                            <td style="padding: 8px 0;">174.60</td>
                            <td style="padding: 8px 0; color: #FF3B30;">-1.89%</td>
                            <td style="padding: 8px 0; color: var(--text-dim);">112M</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    return { pane: pane };
})();
